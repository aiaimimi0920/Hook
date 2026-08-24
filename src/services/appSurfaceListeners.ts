import type { Setter } from "solid-js";

import { graphStore } from "../store/graphStore";
import { SurfaceStateError, surfaceStore } from "../store/surfaceStore";
import { surfaceResourceStore } from "../store/surfaceResourceStore";
import { api } from "./api";
import { artExecutionRequests } from "./artExecutionRequests";
import type { ArtDelivery } from "./protocol";
import { loomHook } from "./client";
import { normalizeImageSourceForDisplay } from "./imageSource";
import { surfaceAttachmentRequests } from "./surfaceAttachmentRequests";
import {
    SURFACE_PROTOCOL_VERSION,
    type SurfaceConfirmationRequest,
    type SurfaceLifecycleState,
    type SurfacePortValue,
} from "./surfaceProtocol";
import { syncService } from "./syncService";
import type { AppListenerRegistry } from "./appListenerRegistry";

type AppSurfaceListenerDependencies = {
    registry: AppListenerRegistry;
    handleArtDelivery: (delivery: ArtDelivery) => Promise<void>;
    propagateFromUnit: (unitId: string) => void;
    setSurfaceConfirmations: Setter<SurfaceConfirmationRequest[]>;
    transitionSurfaceLifecycle: (
        unitId: string,
        state: SurfaceLifecycleState,
    ) => Promise<void>;
};

const surfacePortValue = (port: SurfacePortValue): unknown => {
    switch (port.kind) {
        case "value":
            return port.value;
        case "resource":
            return port.resource;
        case "stream":
            return port.stream;
    }
};

const surfacePreviewSource = (port: SurfacePortValue): string | undefined => {
    if (port.kind !== "value") return undefined;
    const value = port.value;
    if (typeof value === "string") return normalizeImageSourceForDisplay(value);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    const source = (value as Record<string, unknown>).src;
    return typeof source === "string" ? normalizeImageSourceForDisplay(source) : undefined;
};

/** Applies and dispatches one monotonic Surface lifecycle transition. */
export async function transitionAppSurfaceLifecycle(
    unitId: string,
    state: SurfaceLifecycleState,
): Promise<void> {
    const current = surfaceStore.byUnit[unitId];
    if (!current || current.lifecycle === "disposed" || current.lifecycle === state) return;
    const event = {
        protocolVersion: SURFACE_PROTOCOL_VERSION,
        instanceId: current.snapshot.instanceId,
        attachmentId: current.snapshot.attachmentId,
        state,
        revision: current.lifecycleRevision + 1,
    };
    if (!surfaceStore.actions.applyLifecycle(unitId, event)) return;
    try {
        await loomHook.dispatchSurfaceLifecycle(event);
    } catch (error) {
        console.warn(`Failed to move Surface ${unitId} to ${state}:`, error);
    }
}

/** Registers Art delivery and Surface protocol listeners owned by the app mount. */
export async function registerAppSurfaceListeners({
    registry,
    handleArtDelivery,
    propagateFromUnit,
    setSurfaceConfirmations,
    transitionSurfaceLifecycle,
}: AppSurfaceListenerDependencies): Promise<void> {
    const onSurfaceVisibilityChange = () => {
        const state: SurfaceLifecycleState = document.hidden ? "suspended" : "active";
        for (const unitId of Object.keys(surfaceStore.byUnit)) {
            void transitionSurfaceLifecycle(unitId, state);
        }
    };
    document.addEventListener("visibilitychange", onSurfaceVisibilityChange);
    registry.push(() => {
        document.removeEventListener("visibilitychange", onSurfaceVisibilityChange);
    });

    await registry.register(() => loomHook.listenForProgress((artId, progress, requestId) => {
        if (requestId && !artExecutionRequests.isLatest(artId, requestId)) return;
        graphStore.actions.updateUnitData(artId, {
            processing: true,
            nodeStatus: "running",
            progress,
        });
    }));

    await registry.register(() => loomHook.listenForDelivery((delivery) => {
        handleArtDelivery(delivery).catch((error) => {
            console.error("Failed to process art delivery", error);
            if (!artExecutionRequests.isLatest(delivery.art_id, delivery.request_id)) return;
            if (delivery.phase === "preview") {
                void api.debugLogEvent(
                    "art-delivery-preview-read-failed",
                    `unit=${delivery.art_id} request=${delivery.request_id} error=${error instanceof Error ? error.message : String(error)}`,
                );
                return;
            }
            graphStore.actions.updateUnitData(delivery.art_id, {
                processing: false,
                nodeStatus: "error",
                errorMessage: error instanceof Error ? error.message : String(error),
            });
            artExecutionRequests.finish(delivery.art_id, delivery.request_id);
        });
    }));

    const surfaceRemountsInFlight = new Set<string>();
    await registry.register(() => loomHook.listenForSurfaceReset(() => {
        surfaceRemountsInFlight.clear();
        setSurfaceConfirmations([]);
        surfaceStore.actions.clearAll();
        surfaceResourceStore.actions.clearAll();
        surfaceAttachmentRequests.clearAll();
    }));

    await registry.register(() => loomHook.listenForSurfaceSnapshot((delivery) => {
        const unit = graphStore.units.find((candidate) => candidate.id === delivery.hookNodeId);
        if (!unit || unit.type !== "art") {
            console.warn("Ignoring Surface snapshot for unknown non-Art node", delivery.hookNodeId);
            return;
        }
        try {
            surfaceStore.actions.mountSnapshot(
                delivery.hookNodeId,
                delivery.snapshot,
                delivery.generation,
            );
            surfaceAttachmentRequests.complete(delivery.hookNodeId);
            graphStore.actions.updateUnitData(delivery.hookNodeId, {
                processing: false,
                nodeStatus: "completed",
                errorMessage: undefined,
            });
        } catch (error) {
            graphStore.actions.updateUnitData(delivery.hookNodeId, {
                nodeStatus: "error",
                errorMessage: error instanceof Error ? error.message : String(error),
            });
        }
    }));

    await registry.register(() => loomHook.listenForSurfacePatch((delivery) => {
        const current = surfaceStore.byUnit[delivery.hookNodeId];
        if (!current || current.snapshot.instanceId !== delivery.patch.instanceId) return;
        if (delivery.patch.revision <= current.snapshot.revision) return;
        try {
            surfaceStore.actions.applyPatch(delivery.hookNodeId, delivery.patch);
            surfaceStore.actions.setGeneration(delivery.hookNodeId, delivery.generation);
        } catch (error) {
            if (error instanceof SurfaceStateError && error.code === "revision_conflict") {
                const recoveryKey = `${delivery.patch.instanceId}:${current.snapshot.attachmentId}`;
                if (!surfaceRemountsInFlight.has(recoveryKey)) {
                    surfaceRemountsInFlight.add(recoveryKey);
                    void loomHook.remountSurface(
                        delivery.patch.instanceId,
                        current.snapshot.attachmentId,
                        delivery.hookNodeId,
                    ).catch((recoveryError) => {
                        graphStore.actions.updateUnitData(delivery.hookNodeId, {
                            nodeStatus: "error",
                            errorMessage: recoveryError instanceof Error
                                ? recoveryError.message
                                : "Surface snapshot recovery failed",
                        });
                    }).finally(() => {
                        surfaceRemountsInFlight.delete(recoveryKey);
                    });
                }
                return;
            }
            graphStore.actions.updateUnitData(delivery.hookNodeId, {
                nodeStatus: "error",
                errorMessage: error instanceof Error ? error.message : String(error),
            });
        }
    }));

    await registry.register(() => loomHook.listenForSurfaceGeneration((delivery) => {
        const current = surfaceStore.byUnit[delivery.hookNodeId];
        if (
            current?.snapshot.instanceId === delivery.instanceId
            && current.snapshot.attachmentId === delivery.attachmentId
        ) {
            surfaceStore.actions.setGeneration(delivery.hookNodeId, delivery.generation);
        }
    }));

    const surfaceUnitIdForInstance = (instanceId: string): string | undefined =>
        Object.entries(surfaceStore.byUnit).find(
            ([, state]) => state?.snapshot.instanceId === instanceId,
        )?.[0];

    await registry.register(() => loomHook.listenForSurfaceActionAck((ack) => {
        if (ack.status !== "awaiting_confirmation") {
            setSurfaceConfirmations((requests) => requests.filter(
                (request) => request.requestId !== ack.requestId,
            ));
        }
        const unitId = surfaceUnitIdForInstance(ack.instanceId);
        if (!unitId) return;
        if (ack.status === "awaiting_confirmation") {
            graphStore.actions.updateUnitData(unitId, {
                processing: false,
                nodeStatus: "idle",
                errorMessage: undefined,
            });
            return;
        }
        if (ack.status === "queued" || ack.status === "running" || ack.status === "accepted") {
            graphStore.actions.updateUnitData(unitId, {
                processing: true,
                nodeStatus: "running",
                errorMessage: undefined,
            });
            return;
        }
        if (ack.status === "succeeded") {
            graphStore.actions.updateUnitData(unitId, {
                processing: false,
                progress: 1,
                nodeStatus: "completed",
                errorMessage: undefined,
            });
            return;
        }
        if (["failed", "cancelled", "interrupted"].includes(ack.status)) {
            graphStore.actions.updateUnitData(unitId, {
                processing: false,
                nodeStatus: ack.status === "cancelled" ? "idle" : "error",
                errorMessage: ack.error?.message,
            });
        }
    }));

    await registry.register(() => loomHook.listenForSurfaceConfirmation((request) => {
        if (request.protocolVersion !== SURFACE_PROTOCOL_VERSION) return;
        if (request.expiresAtMs <= Date.now()) {
            void loomHook.decideSurfaceConfirmation({
                protocolVersion: SURFACE_PROTOCOL_VERSION,
                confirmationId: request.confirmationId,
                instanceId: request.instanceId,
                attachmentId: request.attachmentId,
                deviceId: request.deviceId,
                approved: false,
            });
            return;
        }
        setSurfaceConfirmations((current) => current.some(
            (candidate) => candidate.confirmationId === request.confirmationId,
        ) ? current : [...current, request]);
    }));

    await registry.register(() => loomHook.listenForSurfaceProgress((progress) => {
        const unitId = surfaceUnitIdForInstance(progress.instanceId);
        const current = unitId ? surfaceStore.byUnit[unitId] : undefined;
        if (!unitId || !current || current.generation !== progress.generation) return;
        if (typeof progress.value === "number") {
            graphStore.actions.updateUnitData(unitId, {
                processing: progress.value < 1,
                nodeStatus: progress.value < 1 ? "running" : "completed",
                progress: Math.max(0, Math.min(1, progress.value)),
            });
        }
    }));

    await registry.register(() => loomHook.listenForSurfacePreview((delivery) => {
        if (!surfaceStore.actions.acceptPreviewCommit(delivery.hookNodeId, delivery.commit)) return;
        const previewSrc = surfacePreviewSource(delivery.commit.value);
        if (!previewSrc) return;
        graphStore.actions.updateUnitData(delivery.hookNodeId, {
            previewSrc,
            processing: true,
            nodeStatus: "running",
            errorMessage: undefined,
        });
    }));

    await registry.register(() => loomHook.listenForSurfaceResult((delivery) => {
        if (!surfaceStore.actions.acceptResultCommit(delivery.hookNodeId, delivery.commit)) return;
        const unit = graphStore.units.find((candidate) => candidate.id === delivery.hookNodeId);
        if (!unit || unit.type !== "art") return;
        const outputs = Object.fromEntries(
            Object.entries(delivery.commit.outputs).map(([portId, value]) => [
                portId,
                surfacePortValue(value),
            ]),
        );
        graphStore.actions.updateUnitData(delivery.hookNodeId, {
            outputs,
            processing: false,
            progress: 1,
            nodeStatus: "completed",
            errorMessage: undefined,
        });
        propagateFromUnit(delivery.hookNodeId);
        void syncService.performWorkflowSync();
    }));

    await registry.register(() => loomHook.listenForSurfaceFailure((delivery) => {
        const unitId = delivery.hookNodeId ?? surfaceUnitIdForInstance(delivery.failure.instanceId);
        const current = unitId ? surfaceStore.byUnit[unitId] : undefined;
        if (!unitId || !current || current.generation !== delivery.failure.generation) return;
        graphStore.actions.updateUnitData(unitId, {
            processing: false,
            nodeStatus: "error",
            errorMessage: delivery.failure.error.message,
        });
    }));

    await registry.register(() => loomHook.listenForSurfaceLifecycle((delivery) => {
        const applied = surfaceStore.actions.applyLifecycle(delivery.hookNodeId, delivery.event);
        if (applied && delivery.event.state === "disposed") {
            setSurfaceConfirmations((requests) => requests.filter((request) =>
                request.instanceId !== delivery.event.instanceId
                || request.attachmentId !== delivery.event.attachmentId));
            surfaceStore.actions.clear(delivery.hookNodeId);
            surfaceAttachmentRequests.clear(delivery.hookNodeId);
        }
    }));

    await registry.register(() => loomHook.listenForSurfaceDispose((delivery) => {
        const current = surfaceStore.byUnit[delivery.hookNodeId];
        if (
            current?.snapshot.instanceId === delivery.instanceId
            && current.snapshot.attachmentId === delivery.attachmentId
        ) {
            setSurfaceConfirmations((requests) => requests.filter((request) =>
                request.instanceId !== delivery.instanceId
                || request.attachmentId !== delivery.attachmentId));
            surfaceStore.actions.clear(delivery.hookNodeId);
        }
    }));

    await registry.register(() => loomHook.listenForSurfaceResource((delivery) => {
        if (!surfaceResourceStore.actions.complete(
            delivery.resourceId,
            delivery.dataUrl,
            delivery.expiresAtMs,
        )) {
            surfaceResourceStore.actions.fail(delivery.resourceId);
            console.warn("Ignoring invalid or expired Surface resource", delivery.resourceId);
        }
    }));
}
