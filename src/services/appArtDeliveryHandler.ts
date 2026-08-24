import { graphStore } from "../store/graphStore";
import { api } from "./api";
import { artExecutionRequests } from "./artExecutionRequests";
import {
    isRecoverableCandidateExecutionFailure,
    mergeCandidateRuntimeState,
    prefetchCandidateAssets,
} from "./artCandidateCache";
import { extractArtDeliveryCandidatesState } from "./artDeliveryCandidates";
import {
    extractArtDeliveryValueOutputs,
    materializeSharedMemoryOutputs,
    mergeArtDeliveryOutputs,
} from "./artDeliveryOutputs";
import { normalizeImageSourceForDisplay } from "./imageSource";
import type { ArtDelivery } from "./protocol";
import { syncService } from "./syncService";

type PropagateFromUnit = (unitId: string) => void;

/** Creates the ordered preview/final Art delivery pipeline for the app owner. */
export function createAppArtDeliveryHandler(propagateFromUnit: PropagateFromUnit) {
    return async (delivery: ArtDelivery): Promise<void> => {
        const unitId = delivery.art_id;
        const phase = delivery.phase ?? "final";
        const sharedMemoryHandles = new Set<string>();
        const collectSharedMemoryHandle = (value: unknown) => {
            if (
                value
                && typeof value === "object"
                && (value as { type?: unknown }).type === "shared_memory"
                && typeof (value as { handle?: unknown }).handle === "string"
                && (value as { handle: string }).handle.startsWith("Loom_Buffer_")
            ) {
                sharedMemoryHandles.add((value as { handle: string }).handle);
            }
        };
        collectSharedMemoryHandle(delivery.delivery);
        if ("outputs" in delivery.delivery) {
            Object.values(delivery.delivery.outputs ?? {}).forEach(collectSharedMemoryHandle);
        }
        const releaseSharedMemoryHandles = () => {
            if (sharedMemoryHandles.size === 0 || delivery.generation === undefined) return;
            void api.releaseArtSharedMemory(
                unitId,
                delivery.request_id,
                delivery.generation,
                [...sharedMemoryHandles],
            );
            sharedMemoryHandles.clear();
        };
        const isCurrentDelivery = () =>
            artExecutionRequests.isLatest(unitId, delivery.request_id)
            && (
                delivery.generation === undefined
                || artExecutionRequests.generation(unitId, delivery.request_id) === delivery.generation
            );
        if (!isCurrentDelivery()) {
            releaseSharedMemoryHandles();
            void api.debugLogEvent(
                "art-delivery-discarded-stale",
                `unit=${unitId} request=${delivery.request_id}`,
            );
            return;
        }
        const unit = graphStore.units.find((item) => item.id === unitId);
        if (!unit) {
            releaseSharedMemoryHandles();
            return;
        }
        const candidateState = extractArtDeliveryCandidatesState(delivery.delivery);
        const mergedCandidates = mergeCandidateRuntimeState(
            unit.data.resultCandidates,
            candidateState.resultCandidates,
        );

        if (delivery.status !== 200) {
            const candidateRecoveryPending = isRecoverableCandidateExecutionFailure(
                delivery.error,
                mergedCandidates,
            );
            graphStore.actions.updateUnitData(unitId, {
                resultCandidates: mergedCandidates,
                selectedResultIndex: candidateState.selectedResultIndex,
                processing: false,
                restoredPreviewLocked: false,
                nodeStatus: "error",
                errorMessage: delivery.error || "Art execution failed",
                imageSearchRecoveryPending: candidateRecoveryPending,
            });
            releaseSharedMemoryHandles();
            artExecutionRequests.finish(unitId, delivery.request_id);
            if (candidateRecoveryPending) {
                void prefetchCandidateAssets({
                    unitId,
                    candidates: mergedCandidates,
                    selectedIndex: candidateState.selectedResultIndex,
                });
            }
            await syncService.performWorkflowSync();
            return;
        }

        let previewSrc: string | undefined;
        let filePath: string | undefined;
        let outputValues: Record<string, unknown> | undefined;
        try {
            switch (delivery.delivery.type) {
                case "shared_memory":
                    if (
                        delivery.delivery.format !== "rgba8"
                        || !delivery.delivery.handle?.startsWith("Loom_Buffer_")
                        || typeof delivery.delivery.size !== "number"
                        || !Number.isSafeInteger(delivery.delivery.size)
                        || delivery.delivery.size <= 0
                        || typeof delivery.delivery.width !== "number"
                        || !Number.isSafeInteger(delivery.delivery.width)
                        || delivery.delivery.width <= 0
                        || typeof delivery.delivery.height !== "number"
                        || !Number.isSafeInteger(delivery.delivery.height)
                        || delivery.delivery.height <= 0
                    ) {
                        graphStore.actions.updateUnitData(unitId, {
                            processing: false,
                            restoredPreviewLocked: false,
                            nodeStatus: "error",
                            errorMessage: "Loom returned an invalid shared-memory Art output",
                        });
                        releaseSharedMemoryHandles();
                        artExecutionRequests.finish(unitId, delivery.request_id);
                        await syncService.performWorkflowSync();
                        return;
                    }
                    previewSrc = await api.readSharedMemory(
                        delivery.delivery.handle,
                        delivery.delivery.size,
                        delivery.delivery.width,
                        delivery.delivery.height,
                    );
                    break;
                case "base64":
                    previewSrc = delivery.delivery.data;
                    break;
                case "file_path":
                    filePath = delivery.delivery.path;
                    if (filePath) previewSrc = normalizeImageSourceForDisplay(filePath);
                    break;
                case "shader":
                    graphStore.actions.updateUnitData(unitId, {
                        processing: false,
                        restoredPreviewLocked: false,
                        nodeStatus: "completed",
                        progress: 1,
                        errorMessage: undefined,
                    });
                    artExecutionRequests.finish(unitId, delivery.request_id);
                    await syncService.performWorkflowSync();
                    return;
                case "value":
                    outputValues = extractArtDeliveryValueOutputs(delivery.delivery);
                    break;
            }
            if (!outputValues && delivery.delivery.type !== "value" && "outputs" in delivery.delivery) {
                outputValues = { ...delivery.delivery.outputs };
            }
            if (outputValues) {
                outputValues = await materializeSharedMemoryOutputs({
                    outputs: outputValues,
                    primaryHandle: delivery.delivery.type === "shared_memory"
                        ? delivery.delivery.handle
                        : undefined,
                    primaryData: previewSrc,
                    readSharedMemory: api.readSharedMemory,
                });
            }
        } catch (error) {
            releaseSharedMemoryHandles();
            graphStore.actions.updateUnitData(unitId, {
                processing: false,
                restoredPreviewLocked: false,
                nodeStatus: "error",
                errorMessage: error instanceof Error
                    ? error.message
                    : "Failed to materialize Loom shared-memory Art output",
            });
            artExecutionRequests.finish(unitId, delivery.request_id);
            await syncService.performWorkflowSync();
            return;
        }

        if (!isCurrentDelivery()) {
            releaseSharedMemoryHandles();
            void api.debugLogEvent(
                "art-delivery-discarded-after-read",
                `unit=${unitId} request=${delivery.request_id}`,
            );
            return;
        }
        const currentUnit = graphStore.units.find((item) => item.id === unitId);
        if (!currentUnit) {
            releaseSharedMemoryHandles();
            artExecutionRequests.finish(unitId, delivery.request_id);
            return;
        }

        if (phase === "preview") {
            if (previewSrc) {
                graphStore.actions.updateUnitData(unitId, {
                    previewSrc,
                    processing: true,
                    nodeStatus: "running",
                    errorMessage: undefined,
                    restoredPreviewLocked: false,
                });
                artExecutionRequests.markPreview(unitId, delivery.request_id, previewSrc);
                void api.debugLogEvent(
                    "art-delivery-applied-preview",
                    `unit=${unitId} request=${delivery.request_id}`,
                );
            }
            releaseSharedMemoryHandles();
            return;
        }

        const workflowPreviewSrc = artExecutionRequests.getPreview(unitId, delivery.request_id);
        const currentMergedCandidates = mergeCandidateRuntimeState(
            currentUnit.data.resultCandidates,
            candidateState.resultCandidates,
        );
        const nextOutputs = mergeArtDeliveryOutputs({
            currentOutputs: currentUnit.data.outputs,
            valueOutputs: outputValues,
            previewSrc,
            filePath,
        });
        const replacesImageResult = ["shared_memory", "base64", "file_path"]
            .includes(delivery.delivery.type);

        graphStore.actions.updateUnitData(unitId, {
            previewSrc: workflowPreviewSrc ?? previewSrc ?? currentUnit.data.previewSrc,
            ...(replacesImageResult ? { filePath, resultHandle: undefined } : {}),
            outputs: nextOutputs,
            resultCandidates: currentMergedCandidates,
            selectedResultIndex: candidateState.selectedResultIndex,
            processing: false,
            progress: 1,
            restoredPreviewLocked: false,
            nodeStatus: "completed",
            errorMessage: undefined,
            imageSearchRecoveryPending: false,
        });
        releaseSharedMemoryHandles();
        void api.debugLogEvent(
            "art-delivery-applied-final",
            `unit=${unitId} request=${delivery.request_id} preservedPreview=${Boolean(workflowPreviewSrc)}`,
        );
        artExecutionRequests.finish(unitId, delivery.request_id);
        void prefetchCandidateAssets({
            unitId,
            candidates: currentMergedCandidates,
            selectedIndex: candidateState.selectedResultIndex,
        });
        propagateFromUnit(unitId);
        await syncService.performWorkflowSync();
    };
}
