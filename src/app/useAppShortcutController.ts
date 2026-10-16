import type { Accessor } from "solid-js";

import { graphStore } from "../features/workspace/state/graphStore";
import {
    activeStickerEditTargetId,
    isSelecting,
    longCaptureSession,
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    selectedStickerId,
    stickerToolSettings,
    enhancementNotices,
    uiActions,
} from "../features/workspace/state/uiStore";
import { api } from "../platform/tauri/api";
import type { AppCaptureInputState } from "./appPointerListeners";
import { findArtCapabilityAfterRefresh } from "../features/art/services/artCapabilityLookup";
import type { BootProfile } from "../features/settings/services/bootProfile";
import { resolveShortcutContext } from "../features/capture/services/captureState";
import { logger } from "../shared/diagnostics/logger";
import type { ArtCapability } from "../integrations/loom/protocol";
import { syncService } from "../features/workspace/services/syncService";
import { toggleSelectedStickerToolbar } from "../features/stickers/services/stickerToolbarShortcutRouting";
import { useShortcuts } from "../platform/desktop/useShortcuts";
import { cycleUnitChromeMode } from "../features/workspace/state/unitChromeState";
import { commitLiveCaptureUnitFrame } from "../features/live/services/liveCaptureUnit";
import type { LiveSnapshotActionResult } from "../features/live/services/liveCaptureSnapshotAction";

type AppShortcutControllerDependencies = {
    appSettingsOpen: Accessor<boolean>;
    surfaceConfirmationCount: Accessor<number>;
    activeBootProfile: Accessor<BootProfile | null>;
    captureInput: AppCaptureInputState;
    handleCopy: () => void;
    handlePaste: () => void;
    handleSave: () => void;
    openImageForEdit: () => Promise<void>;
    applyStickerHistorySnapshot: (direction: "undo" | "redo") => void;
    deleteSelectedUnitOrAnnotation: () => void;
    closeSelectedActionsMenu: () => boolean;
    cancelAutoLongCaptureSession: () => Promise<boolean>;
    invalidateCaptureSessionLifecycle: () => void;
    resetSelection: () => void;
    toggleStickerToolbarVisibility: () => void | Promise<void>;
    refreshCapabilities: () => Promise<void>;
    scheduleOverlayHitTestRefresh: () => void;
    spawnConnectedNode: (sourceId: string, artId: string) => LiveSnapshotActionResult<string | null>;
};

/** Binds product shortcut actions while leaving their domain commands injectable. */
export function useAppShortcutController(dependencies: AppShortcutControllerDependencies): void {
    const refreshActionsCapabilities = (unitId: string) => {
        // Shift+1 opens Add Art immediately; report a failed Loom handshake on
        // the selected sticker instead of leaving an unhandled rejection/toast.
        void dependencies.refreshCapabilities()
            .then(() => {
                if (enhancementNotices[unitId]?.some((notice) => notice.feature === "Loom")) {
                    uiActions.dismissEnhancementNoticesByFeature(unitId, "Loom");
                }
            })
            .catch((error: unknown) => {
                console.warn("Unable to refresh Add Art capabilities from Loom Otter", error);
                void api.debugLogEvent(
                    "add-art-capability-refresh-failed",
                    `unit=${unitId} error_type=${error instanceof Error ? error.name : "NonErrorRejection"}`,
                );
                uiActions.closeActions(unitId);
                uiActions.showEnhancementNotice(unitId, {
                    feature: "Loom",
                    title: "Add Art 暂不可用",
                    message: "无法连接 Loom Otter。请启动 Loom 后重试。",
                });
                dependencies.scheduleOverlayHitTestRefresh();
            });
    };

    useShortcuts({
        contextProvider: () => resolveShortcutContext({
            hasBlockingDialog:
                dependencies.appSettingsOpen() || dependencies.surfaceConfirmationCount() > 0,
            hasActiveLongCapture: Boolean(longCaptureSession()?.active),
            isSelecting: isSelecting(),
            hasSelectedSticker: Boolean(selectedStickerId()),
            hasSelectedAnnotation:
                selectedStickerAnnotationIds.length > 0 || Boolean(selectedStickerAnnotationId()),
            hasActiveStickerEditTarget: activeStickerEditTargetId() === selectedStickerId(),
            stickerEditingDomain: stickerToolSettings.domain,
            stickerTransformMode: stickerToolSettings.transformMode,
            stickerCanvasTool: stickerToolSettings.activeCanvasTool,
        }),
        handlers: {
            onCopy: dependencies.handleCopy,
            onPaste: dependencies.handlePaste,
            onSave: dependencies.handleSave,
            onOpenImage: dependencies.openImageForEdit,
            onToggleHistory: () => uiActions.toggleHistoryPanel(),
            onUndoEdit: () => dependencies.applyStickerHistorySnapshot("undo"),
            onRedoEdit: () => dependencies.applyStickerHistorySnapshot("redo"),
            onDelete: dependencies.deleteSelectedUnitOrAnnotation,
            onCloseActions: dependencies.closeSelectedActionsMenu,
            onCancelSelection: async () => {
                if (longCaptureSession()?.active) {
                    await dependencies.cancelAutoLongCaptureSession();
                    return;
                }
                dependencies.invalidateCaptureSessionLifecycle();
                dependencies.captureInput.nativePointerActive = false;
                dependencies.captureInput.ctrlReleasedSinceCaptureStart = false;
                await api.setCaptureInputActive(false);
                dependencies.resetSelection();
                uiActions.setSelectedStickerAnnotation(null);

                const initialUiMode = dependencies.activeBootProfile()?.initialUiMode || "overlay";
                if (initialUiMode === "canvas" && graphStore.units.length > 0) {
                    await api.showCanvasWindow();
                } else if (initialUiMode === "tray" && graphStore.units.length === 0) {
                    await api.hideToTray();
                } else {
                    await api.showOverlayHost(true);
                    if (graphStore.units.length > 0) {
                        await api.setMouseMonitorActive(true);
                        await syncService.updateBackendRects();
                    }
                }
            },
            onCancelStickerEdit: () => uiActions.requestStickerEditCancel(),
            onToggleStickerToolbar: () => {
                toggleSelectedStickerToolbar({
                    fallback: dependencies.toggleStickerToolbarVisibility,
                    refreshHitTest: dependencies.scheduleOverlayHitTestRefresh,
                });
            },
            onToggleActions: () => {
                const id = selectedStickerId();
                if (!id) return;
                commitLiveCaptureUnitFrame(id);
                // Refresh each time because Loom can add tools after Otter starts.
                refreshActionsCapabilities(id);
                uiActions.toggleActions(id);
                dependencies.scheduleOverlayHitTestRefresh();
            },
            onToggleParams: () => {
                const id = selectedStickerId();
                if (!id) return;
                uiActions.toggleParams(id);
                dependencies.scheduleOverlayHitTestRefresh();
            },
            onToggleCleanView: () => {
                logger.debug("Toggle Clean View Mode");
                cycleUnitChromeMode();
                dependencies.scheduleOverlayHitTestRefresh();
            },
            onTransformSelect: () => {
                if (selectedStickerId()) uiActions.setStickerTransformMode("select");
            },
            onTransformMove: () => {
                if (selectedStickerId()) uiActions.setStickerTransformMode("move");
            },
            onTransformRotate: () => {
                if (selectedStickerId()) uiActions.setStickerTransformMode("rotate");
            },
            onTransformScale: () => {
                if (selectedStickerId()) uiActions.setStickerTransformMode("scale");
            },
            onQuickArt: async (artId) => {
                const sourceId = selectedStickerId();
                if (!sourceId) return;
                void api.debugLogEvent(
                    "quick-art-shortcut-triggered",
                    `source=${sourceId} requested=${artId} capabilities=${graphStore.capabilities.length}`,
                );

                let capability: ArtCapability | undefined;
                try {
                    capability = await findArtCapabilityAfterRefresh(
                        artId,
                        () => graphStore.capabilities,
                        async () => {
                            void api.debugLogEvent(
                                "quick-art-capability-refresh",
                                `source=${sourceId} requested=${artId}`,
                            );
                            await dependencies.refreshCapabilities();
                        },
                    );
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.error(`Failed to refresh Art capability for quick binding ${artId}:`, error);
                    void api.debugLogEvent(
                        "quick-art-capability-refresh-failed",
                        `source=${sourceId} requested=${artId} error=${message}`,
                    );
                    return;
                }

                if (!capability) {
                    console.error(`Quick Art binding references an unavailable Art: ${artId}`);
                    void api.debugLogEvent(
                        "quick-art-capability-missing",
                        `source=${sourceId} requested=${artId} capabilities=${graphStore.capabilities.length}`,
                    );
                    return;
                }

                const nodeId = await dependencies.spawnConnectedNode(sourceId, capability.id);
                if (!nodeId) return;
                void api.debugLogEvent(
                    "quick-art-node-created",
                    `source=${sourceId} node=${nodeId} requested=${artId} resolved=${capability.id}`,
                );
            },
        },
    });
}
