import { graphStore } from "../features/workspace/state/graphStore";
import { runWithLiveCaptureSnapshots } from "../features/live/services/liveCaptureSnapshotAction";
import { commitLiveCaptureUnitFrame, isLiveCaptureUnit } from "../features/live/services/liveCaptureUnit";
import {
    activeStickerEditTargetId,
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    selectedStickerId,
    selectedUnitIds,
    selectionActions,
    setActiveStickerEditTargetId,
    uiActions,
    unitUiState,
} from "../features/workspace/state/uiStore";
import type { Unit } from "../features/workspace/types/unit";
import { api } from "../platform/tauri/api";
import { artExecutionRequests } from "../features/art/services/artExecutionRequests";
import { resolveDeletionPlan } from "../features/workspace/services/deletionPlan";
import { removeAnnotationsByIds } from "../features/stickers/services/stickerAnnotationMutations";
import { captureStickerEditSnapshot } from "../features/stickers/services/stickerHistory";
import { addRecycleBinEntry } from "../features/stickers/services/stickerLibraryModel";
import { captureFrozenStickerSnapshot } from "../features/stickers/services/stickerSnapshot";
import { syncService } from "../features/workspace/services/syncService";

type AppStickerEditingControllerDependencies = {
    tauriRuntime: boolean;
    createImageUnit: (
        source: string,
        position?: { x: number; y: number },
    ) => string;
    disposeSurface: (unitId: string, state: "disposed") => Promise<void>;
};

/** Owns sticker toolbar, edit history, deletion, and image-edit entry commands. */
export function createAppStickerEditingController(
    dependencies: AppStickerEditingControllerDependencies,
) {
    let lastToolbarToggleAt = Number.NEGATIVE_INFINITY;
    let toolbarRequest = 0;

    const toggleStickerToolbarVisibility = () => {
        const now = performance.now();
        // Native and focused-WebView Ctrl+E can report the same key edge.
        if (now - lastToolbarToggleAt < 250) return;
        lastToolbarToggleAt = now;
        const request = ++toolbarRequest;
        const stickerId = selectedStickerId();
        if (dependencies.tauriRuntime) {
            void api.debugLogEvent(
                "toggle-sticker-toolbar",
                `selected=${stickerId ?? "null"} active=${activeStickerEditTargetId() ?? "null"}`,
            );
        }
        if (!stickerId) return;
        const selectedUnit = graphStore.units.find((unit) => unit.id === stickerId);
        if (selectedUnit?.type !== "sticker" && selectedUnit?.type !== "art") return;

        if (activeStickerEditTargetId() === stickerId) {
            uiActions.hideStickerToolbar();
            return;
        }
        return runWithLiveCaptureSnapshots([stickerId], () => {
            if (request !== toolbarRequest || selectedStickerId() !== stickerId) return;
            const current = graphStore.units.find((unit) => unit.id === stickerId);
            if (!current || activeStickerEditTargetId() === stickerId) return;
            uiActions.showStickerToolbar(stickerId);
            if (current.type === "art") uiActions.setStickerEditMode("select");
        });
    };

    const scheduleOverlayHitTestRefresh = (
        options: { forceClickThrough?: boolean } = {},
    ) => {
        window.setTimeout(() => {
            void (async () => {
                if (options.forceClickThrough) await api.setOverlayClickThrough(true);
                if (graphStore.units.length > 0) {
                    await api.setMouseMonitorActive(true);
                    await syncService.updateBackendRects();
                }
            })();
        }, 0);
    };

    const closeSelectedActionsMenu = () => {
        const id = selectedStickerId();
        if (!id || !unitUiState[id]?.showActions) return false;
        uiActions.closeActions(id);
        scheduleOverlayHitTestRefresh();
        return true;
    };

    const applyStickerHistorySnapshot = async (direction: "undo" | "redo") => {
        const id = selectedStickerId();
        if (!id) return;
        const unit = graphStore.units.find((item) => item.id === id);
        if (!unit || (unit.type !== "sticker" && unit.type !== "art")) return;
        const current = captureStickerEditSnapshot(unit, { includeImageData: true });
        const snapshot = direction === "undo"
            ? uiActions.undoStickerHistory(id, current)
            : uiActions.redoStickerHistory(id, current);
        if (!snapshot) return;
        graphStore.actions.restoreStickerEditSnapshot(id, snapshot);
        graphStore.actions.propagateStickerEditsFrom(id);
        await syncService.performWorkflowSync();
    };

    const deleteSelectedUnitOrAnnotation = () => {
        const plan = resolveDeletionPlan({
            selectedAnnotationId: selectedStickerAnnotationId(),
            selectedAnnotationIds: [...selectedStickerAnnotationIds],
            selectedStickerId: selectedStickerId(),
            selectedUnitIds: [...selectedUnitIds],
            units: graphStore.units,
        });

        if (plan.kind === "annotation") {
            const activeUnit = graphStore.units.find((unit) => unit.id === plan.unitId);
            if (activeUnit?.data.annotationState) {
                const nextAnnotationState = removeAnnotationsByIds(
                    activeUnit.data.annotationState,
                    plan.annotationIds,
                );
                if (nextAnnotationState === activeUnit.data.annotationState) {
                    uiActions.setSelectedStickerAnnotation(null);
                    return;
                }
                uiActions.pushStickerHistory(
                    plan.unitId,
                    captureStickerEditSnapshot(activeUnit),
                );
                graphStore.actions.updateStickerEditData(plan.unitId, {
                    annotationState: nextAnnotationState,
                });
                graphStore.actions.propagateStickerEditsFrom(plan.unitId);
                uiActions.setSelectedStickerAnnotation(null);
                void syncService.performWorkflowSync();
            }
            return;
        }

        if (plan.kind !== "units") return;
        const ids = plan.unitIds;
        // Closing must work even when GPU readback fails or never completes.
        // Recycle the latest retained frame instead of requiring a fresh snapshot.
        ids.forEach(commitLiveCaptureUnitFrame);
        ids.forEach((id) => void dependencies.disposeSurface(id, "disposed"));
        const recycleEntries = ids
            .map((id) => graphStore.units.find((unit) => unit.id === id))
            .filter((unit): unit is Unit => !!unit && unit.type === "sticker"
                && (!!unit.data.src || !isLiveCaptureUnit(unit.id)))
            .map((unit) => captureFrozenStickerSnapshot(unit));
        if (recycleEntries.length > 0) {
            graphStore.setRecycleBin(
                recycleEntries.reduce(
                    (entries, entry) => addRecycleBinEntry(entries, entry),
                    [...graphStore.recycleBin],
                ),
            );
        }

        ids.forEach((id) => graphStore.actions.removeUnit(id));
        ids.forEach((id) => {
            artExecutionRequests.invalidate(id);
            uiActions.clearStickerHistory(id);
            uiActions.clearUnitUiState(id);
            uiActions.dismissEnhancementNotice(id);
        });
        selectionActions.clear();
        uiActions.hideStickerToolbar();
        void syncService.updateBackendRects();
        void syncService.performWorkflowSync();
    };

    const openImageForEdit = async () => {
        try {
            const clipboardData = await api.readClipboardImage();
            if (clipboardData) {
                const stickerId = dependencies.createImageUnit(clipboardData, {
                    x: (typeof window !== "undefined" ? window.innerWidth : 800) / 2,
                    y: (typeof window !== "undefined" ? window.innerHeight : 600) / 2,
                });
                setActiveStickerEditTargetId(stickerId);
                void syncService.performWorkflowSync();
                return;
            }

            const dataUrl = await api.openImageForEdit();
            if (!dataUrl) return;
            const stickerId = dependencies.createImageUnit(dataUrl, {
                x: (typeof window !== "undefined" ? window.innerWidth : 800) / 2,
                y: (typeof window !== "undefined" ? window.innerHeight : 600) / 2,
            });
            setActiveStickerEditTargetId(stickerId);
            void syncService.performWorkflowSync();
        } catch (error) {
            console.error("Open image for edit failed", error);
            await api.debugLogEvent(
                "open-image-for-edit-failure",
                error instanceof Error ? error.message : String(error),
            );
        }
    };

    return {
        toggleStickerToolbarVisibility,
        scheduleOverlayHitTestRefresh,
        closeSelectedActionsMenu,
        applyStickerHistorySnapshot,
        deleteSelectedUnitOrAnnotation,
        openImageForEdit,
    };
}
