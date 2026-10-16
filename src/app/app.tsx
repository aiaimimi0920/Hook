import { onCleanup, createEffect, createSignal, Show, ErrorBoundary } from "solid-js";
import { api, isTauriRuntimeAvailable, type TeaTicketSummary, type VoiceSettingsSummary } from "../platform/tauri/api";
import { type AppCaptureInputState } from "./appPointerListeners";
import {
    type VoiceHotkeyPayload,
    type VoiceSessionPayload,
    type VoiceStatus,
} from "./appCommandListeners";
import { createAppArtDeliveryHandler } from "./appArtDeliveryHandler";
import { createAppCanvasInteractions } from "./appCanvasInteractions";
import { transitionAppSurfaceLifecycle } from "./appSurfaceListeners";
import { useAppStartupLifecycle } from "./appStartupLifecycle";
import { createAppArtWorkflowController } from "./appArtWorkflowController";
import { createAppNativeActionController } from "./appNativeActionController";
import { installNativeFocusPolling } from "../platform/desktop/nativeFocusPolling";
import { createAppStickerEditingController } from "./appStickerEditingController";
import { createAppTeaTicketController } from "./appTeaTicketController";
import { useAppShortcutController } from "./useAppShortcutController";
import {
  installEditableFocusLifecycle,
  notifyNativeAppFocus,
} from "../platform/desktop/editableFocus";
import "../app.css";

// Components
import { CanvasLinks } from "../features/workspace/components/CanvasLinks";
import { CanvasOverlayLayers, type CanvasOverlayLayerRefs } from "../features/workspace/components/CanvasOverlayLayers";
import { CanvasUnits } from "../features/workspace/components/CanvasUnits";
import { CanvasSelection } from "../features/workspace/components/CanvasSelection";
import { StickerGroupBar } from "../features/stickers/components/StickerGroupBar";
import { HistoryPanel } from "../features/workspace/components/HistoryPanel";
import { StickerContextMenuLayer } from "../features/stickers/components/StickerContextMenuLayer";
import { AppSettingsDialog } from "../features/settings/components/AppSettingsDialog";
import { SurfaceConfirmationDialog } from "../features/surfaces/components/SurfaceConfirmationDialog";
import { ExtensionCommandPalette } from "../features/extensions/components/ExtensionCommandPalette";
import { LiveFeatures } from "../features/live/components/LiveFeatures";
import { QrProjectionFeatures } from "../features/projection/components/QrProjectionFeatures";

// Stores & Services
import { graphStore } from "../features/workspace/state/graphStore";
import {
    linkingState,
    isSelecting,
    selectedStickerId,
    uiActions,
    longCaptureSession,
    draggingStickerId,
} from "../features/workspace/state/uiStore";


import { loomOtter } from "../integrations/loom/client";
import { syncService } from "../features/workspace/services/syncService";
import {
    createOverlaySyntheticDispatcher,
} from "../platform/desktop/overlaySyntheticEvents";
import {
    mergeArtDeliveryOutputs,
} from "../features/art/services/artDeliveryOutputs";
import {
  requiresFormalExecutionAfterPreview,
  supportsShaderPreview,
} from "../features/art/services/artCapabilities";
import {
    findArtCapability,
} from "../features/art/services/artCapabilityLookup";
import type { BootProfile } from "../features/settings/services/bootProfile";
import { stickerContextMenuController } from "../features/stickers/services/stickerContextMenuController";
import { createLiveCaptureController } from "../features/live/services/liveCaptureController";
import {
    toggleSelectedStickerToolbar,
} from "../features/stickers/services/stickerToolbarShortcutRouting";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../features/settings/types/appSettings";

// Hooks
import { useDraggable } from "../features/workspace/hooks/useDraggable";
import { useSelection } from "../features/capture/hooks/useSelection";
import { checkDragModifier, ShortcutManager } from "../platform/desktop/useShortcuts";
import { useLinking } from "../features/workspace/hooks/useLinking";
import { useUnitActions } from "../features/workspace/hooks/useUnitActions";
import { useClipboard } from "../features/workspace/hooks/useClipboard";
import { useFileDrop } from "../features/workspace/hooks/useFileDrop";
import {
    SURFACE_PROTOCOL_VERSION,
    type SurfaceConfirmationRequest,
} from "../features/surfaces/services/surfaceProtocol";

export default function App() {
  const [canvasOverlayLayers, setCanvasOverlayLayers] = createSignal<CanvasOverlayLayerRefs>({});
  let activeBootProfile: BootProfile | null = null;
  const tauriRuntime = isTauriRuntimeAvailable();
  const disposeEditableFocusLifecycle = installEditableFocusLifecycle();
  onCleanup(disposeEditableFocusLifecycle);
  if (tauriRuntime) {
      onCleanup(installNativeFocusPolling({
          hasForegroundWindow: api.hasForegroundWindow,
          notifyFocusChanged: notifyNativeAppFocus,
      }));
  }
  const [_voiceStatus, setVoiceStatus] = createSignal<VoiceStatus>("idle");
  const [_lastVoiceHotkey, setLastVoiceHotkey] = createSignal<VoiceHotkeyPayload | null>(null);
  const [lastVoiceSession, setLastVoiceSession] = createSignal<VoiceSessionPayload | null>(null);
  const [_voiceSettings, setVoiceSettings] = createSignal<VoiceSettingsSummary | null>(null);
  const [lastTeaTicket, setLastTeaTicket] = createSignal<TeaTicketSummary | null>(null);
  const [lastTeaTicketError, setLastTeaTicketError] = createSignal<string | null>(null);
  const [appSettings, setAppSettings] = createSignal<AppSettings>({
      ...DEFAULT_APP_SETTINGS,
      fileNaming: { ...DEFAULT_APP_SETTINGS.fileNaming },
  });
  const [appSettingsOpen, setAppSettingsOpen] = createSignal(false);
  const [surfaceConfirmations, setSurfaceConfirmations] = createSignal<SurfaceConfirmationRequest[]>([]);
  const [surfaceConfirmationSubmitting, setSurfaceConfirmationSubmitting] = createSignal(false);
  const [surfaceConfirmationError, setSurfaceConfirmationError] = createSignal<string>();
  const [sessionConflictMessage, setSessionConflictMessage] = createSignal<string>();
  const onSessionRevisionConflict = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setSessionConflictMessage(
          detail?.message ?? "Loom 与 Otter 同时修改了画布。请刷新后重试。",
      );
  };
  window.addEventListener("otter:session-revision-conflict", onSessionRevisionConflict);
  onCleanup(() => {
      window.removeEventListener("otter:session-revision-conflict", onSessionRevisionConflict);
  });

  const decideCurrentSurfaceConfirmation = async (approved: boolean) => {
      const current = surfaceConfirmations()[0];
      if (!current || surfaceConfirmationSubmitting()) return;
      setSurfaceConfirmationSubmitting(true);
      setSurfaceConfirmationError(undefined);
      try {
          await loomOtter.decideSurfaceConfirmation({
              protocolVersion: SURFACE_PROTOCOL_VERSION,
              confirmationId: current.confirmationId,
              instanceId: current.instanceId,
              attachmentId: current.attachmentId,
              deviceId: current.deviceId,
              approved,
          });
          setSurfaceConfirmations((requests) =>
              requests.filter((request) => request.confirmationId !== current.confirmationId));
      } catch (error) {
          setSurfaceConfirmationError(error instanceof Error ? error.message : String(error));
      } finally {
          setSurfaceConfirmationSubmitting(false);
      }
  };

  // Hooks Integration
  const liveCaptureController = createLiveCaptureController(api);
  onCleanup(liveCaptureController.dispose);
  const { startDrag, handleDragMove, handleDragEnd } = useDraggable();
  // The synthetic dispatcher is created below because it needs the live
  // linking/dragging accessors. Capture teardown receives this late-bound
  // callback so it can clear stale overlay hover without reordering hooks.
  let clearCaptureHover = () => {};
  const {
      handleSelectionStart,
      handleSelectionMove,
      handleSelectionEnd,
      resetSelection,
      beginCaptureSessionLifecycle,
      invalidateCaptureSessionLifecycle,
      finishAutoLongCaptureSession,
      cancelAutoLongCaptureSession,
      notifyAutoLongCaptureWheel,
      prepareCaptureWindowTargets,
  } = useSelection(
      () => clearCaptureHover(),
      liveCaptureController.start,
  );
  const { handleParamChange, handleDoubleClick, spawnConnectedNode, propagateFromUnit } = useUnitActions();
  const { startLinking, handleLinkDrop, handleInputLinkDrag, handleLinkHover } = useLinking({
      onLinkCreated: (sourceId) => {
          graphStore.actions.propagateStickerEditsFrom(sourceId);
          // Defer propagation to a microtask so it runs after the synchronous
          // store writes above settle, without the arbitrary 20ms delay.
          queueMicrotask(() => propagateFromUnit(sourceId));
      },
  });
  const { handlePaste, handleCopy, handleSave, createImageUnit } = useClipboard(); // Assuming I implement Copy later if needed
  useFileDrop();

  const overlaySynthetic = createOverlaySyntheticDispatcher({
      doc: document,
      isLinking: () => linkingState().isLinking,
      getDraggingStickerId: draggingStickerId,
      now: Date.now,
  });
  clearCaptureHover = overlaySynthetic.clearHover;
  const captureInput: AppCaptureInputState = {
      nativePointerActive: false,
      ctrlReleasedSinceCaptureStart: false,
  };

  const { createTeaTicketFromCurrentOtterState } = createAppTeaTicketController({
      lastVoiceSession,
      setLastTeaTicket,
      setLastTeaTicketError,
  });
  const {
      refreshCapabilities,
      applyLoomManagedSettings,
      instantiateWorkflowSnapshot,
  } = createAppArtWorkflowController({
      setAppSettings,
      applyLoomShortcutSettings: (settings) => ShortcutManager.applyLoomSettings(settings),
  });

  const handleArtDelivery = createAppArtDeliveryHandler(propagateFromUnit);

  const {
      toggleStickerToolbarVisibility,
      scheduleOverlayHitTestRefresh,
      closeSelectedActionsMenu,
      applyStickerHistorySnapshot,
      deleteSelectedUnitOrAnnotation,
      openImageForEdit,
  } = createAppStickerEditingController({
      tauriRuntime,
      createImageUnit,
      disposeSurface: transitionAppSurfaceLifecycle,
  });

  createEffect(() => {
      if (!tauriRuntime) return;
      void api.setOverlayKeyboardCaptureActive(Boolean(selectedStickerId()) && !isSelecting());
  });

  useAppShortcutController({
      appSettingsOpen,
      surfaceConfirmationCount: () => surfaceConfirmations().length,
      activeBootProfile: () => activeBootProfile,
      captureInput,
      handleCopy,
      handlePaste,
      handleSave,
      openImageForEdit,
      applyStickerHistorySnapshot,
      deleteSelectedUnitOrAnnotation,
      closeSelectedActionsMenu,
      cancelAutoLongCaptureSession,
      invalidateCaptureSessionLifecycle,
      resetSelection,
      toggleStickerToolbarVisibility,
      refreshCapabilities,
      scheduleOverlayHitTestRefresh,
      spawnConnectedNode,
  });

  const {
      beginCaptureSelection,
      abortCaptureSelection,
      handleNativeEscape,
      handleNativeDelete,
  } = createAppNativeActionController({
      activeBootProfile: () => activeBootProfile,
      appSettingsOpen,
      setAppSettingsOpen,
      surfaceConfirmationCount: () => surfaceConfirmations().length,
      rejectCurrentSurfaceConfirmation: () => decideCurrentSurfaceConfirmation(false),
      captureInput,
      overlaySynthetic,
      beginCaptureSessionLifecycle,
      invalidateCaptureSessionLifecycle,
      resetSelection,
      prepareCaptureWindowTargets,
      cancelAutoLongCaptureSession,
      closeSelectedActionsMenu,
      deleteSelectedUnitOrAnnotation,
  });

  // updateBackendRects captures unit and registered-overlay geometry synchronously,
  // keeping this effect subscribed even while an earlier native send is in flight.
  createEffect(() => {
      void syncService.updateBackendRects();
  });

  createEffect(() => {
      if (!isSelecting() && !longCaptureSession()?.active) {
          return;
      }

      stickerContextMenuController.close();
  });

  const {
      handleGlobalMouseDown,
      handleGlobalMouseMove,
      handleGlobalMouseUp,
      onStartDragUnit,
      resolveUnitImage,
  } = createAppCanvasInteractions({
      tauriRuntime,
      overlaySynthetic,
      checkDragModifier,
      handleDragMove,
      handleDragEnd,
      handleSelectionStart,
      handleSelectionMove,
      handleSelectionEnd,
      resetSelection,
      startDrag,
  });

  useAppStartupLifecycle({
      tauriRuntime,
      setActiveBootProfile: (profile) => {
          activeBootProfile = profile;
      },
      setVoiceSettings,
      setAppSettings,
      registerAppCommandListeners: {
          beginCaptureSelection,
          finishAutoLongCaptureSession,
          notifyAutoLongCaptureWheel,
          toggleStickerToolbarVisibility: () => toggleSelectedStickerToolbar({ fallback: toggleStickerToolbarVisibility, refreshHitTest: scheduleOverlayHitTestRefresh }),
          openImageForEdit,
          setAppSettingsOpen,
          handleCopy,
          handlePaste,
          createTeaTicketFromCurrentOtterState,
          setLastVoiceHotkey,
          setLastVoiceSession,
          setVoiceStatus,
          handleEscape: handleNativeEscape,
          handleDelete: handleNativeDelete,
      },
      registerAppPointerListeners: {
          captureInput,
          overlaySynthetic,
          handleSelectionStart,
          handleSelectionMove,
          handleSelectionEnd,
          abortCaptureSelection,
          handleDragMove,
      },
      registerAppArtControlListeners: {
          instantiateWorkflowSnapshot,
          refreshCapabilities,
          applyLoomManagedSettings,
          setAppSettings,
      },
      registerAppSurfaceListeners: {
          handleArtDelivery,
          propagateFromUnit,
          setSurfaceConfirmations,
          transitionSurfaceLifecycle: transitionAppSurfaceLifecycle,
      },
      handleGlobalMouseMove,
      handleGlobalMouseUp,
  });

  return (
    <ErrorBoundary
        fallback={(error, reset) => {
            // A render-time throw is caught here (window.onerror cannot see SolidJS
            // render errors). Show the full message + stack on screen and persist
            // it, so the intermittent content-eraser crash can be read directly
            // instead of surfacing as the webview's bare "uncaught client exception".
            const detail =
                error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
            try {
                window.localStorage.setItem(
                    "otter-last-error",
                    `[${new Date().toISOString()}] render-error\n${detail}`,
                );
            } catch {
                /* ignore */
            }
            if (isTauriRuntimeAvailable()) {
                void api.debugLogEvent("render-error", detail);
            }
            return (
                <div class="otter-render-error">
                    {"render-error (click 重试 to recover)\n\n" + detail}
                    <div class="otter-render-error__actions">
                        <button
                            type="button"
                            class="otter-render-error__retry"
                            onClick={reset}
                        >
                            重试
                        </button>
                    </div>
                </div>
            );
        }}
    >
        <Show when={sessionConflictMessage()}>
            {(message) => (
                <div class="fixed left-3 right-3 top-3 z-[2147483000] border border-[#ffd60a] bg-[#181818] px-4 py-3 text-[#f6f6f6] shadow-2xl">
                    <div class="text-xs font-semibold text-[#ffd60a]">画布修订冲突</div>
                    <div class="mt-1 text-[11px] leading-relaxed">{message()}</div>
                    <div class="mt-3 flex gap-2">
                        <button
                            type="button"
                            class="border border-[#ffd60a] bg-[#ffd60a] px-3 py-1 text-[11px] font-semibold text-black"
                            onClick={() => {
                                setSessionConflictMessage(undefined);
                                void syncService.performWorkflowSync();
                            }}
                        >
                            重试同步
                        </button>
                        <button
                            type="button"
                            class="border border-[#666] px-3 py-1 text-[11px] text-[#ddd]"
                            onClick={() => setSessionConflictMessage(undefined)}
                        >
                            稍后处理
                        </button>
                    </div>
                </div>
            )}
        </Show>
    <main
        id="app-main"
        class="w-screen h-screen bg-transparent overflow-hidden select-none"
        onMouseDown={handleGlobalMouseDown}
        onMouseMove={handleGlobalMouseMove}
        onMouseUp={handleGlobalMouseUp}
        onContextMenu={(e) => e.preventDefault()}
    >
        <CanvasLinks />

        <StickerGroupBar />
        <HistoryPanel
            onReuseScreenshot={(thumbnail) => {
                const center = {
                    x: (typeof window !== "undefined" ? window.innerWidth : 800) / 2,
                    y: (typeof window !== "undefined" ? window.innerHeight : 600) / 2,
                };
                createImageUnit(thumbnail, center);
                void syncService.performWorkflowSync();
            }}
        />

        <CanvasOverlayLayers onLayersChange={setCanvasOverlayLayers} />

        <CanvasUnits
            noticesLayerRef={canvasOverlayLayers().notices}
            onStartDrag={onStartDragUnit}
            onDoubleClick={handleDoubleClick}

            onDelete={(id) => {
                graphStore.actions.removeUnit(id);
                uiActions.clearStickerHistory(id);
                uiActions.clearUnitUiState(id);
                uiActions.dismissEnhancementNotice(id);
                if (selectedStickerId() === id) {
                    uiActions.hideStickerToolbar();
                }
                syncService.updateBackendRects();
                syncService.performWorkflowSync();
            }}
            onAddNode={spawnConnectedNode}
            onParamChange={handleParamChange}

            onLinkStart={startLinking}
            onLinkDrop={handleLinkDrop}
            onLinkMove={handleInputLinkDrag}
            onLinkHover={handleLinkHover}

            onRendered={(id, dataUrl) => {
                const renderedUnit = graphStore.units.find((unit) => unit.id === id);
                const capability = renderedUnit
                    ? findArtCapability(graphStore.capabilities, renderedUnit.artId)
                    : undefined;
                const isIntermediateShaderPreview =
                    supportsShaderPreview(capability)
                    && requiresFormalExecutionAfterPreview(capability);
                graphStore.actions.updateUnitData(id, {
                    previewSrc: dataUrl,
                    restoredPreviewLocked: false,
                    errorMessage: undefined,
                    ...(isIntermediateShaderPreview
                        ? {}
                        : {
                              outputs: mergeArtDeliveryOutputs({
                                  currentOutputs: renderedUnit?.data.outputs,
                                  previewSrc: dataUrl,
                              }),
                              processing: false,
                              progress: 1,
                              nodeStatus: "completed" as const,
                          }),
                });
                if (!isIntermediateShaderPreview) {
                    propagateFromUnit(id);
                }
                void syncService.performWorkflowSync();
            }}

            resolveUnitImage={resolveUnitImage}
            portsLayerRef={canvasOverlayLayers().ports}
        />

        <LiveFeatures />
        <QrProjectionFeatures />

        {/* Layer 3: Selection Overlay */}
        <CanvasSelection />

        <Show when={longCaptureSession()}>
            {(session) => (
                <div class="otter-terminal-shell otter-terminal-shell--strong otter-capture-status-shell absolute right-5 top-5 z-[2147483646] px-4 py-3 text-xs pointer-events-none">
                    <div class="otter-capture-status-title mb-1 text-sm font-semibold">长截图录制中</div>
                    <div>已保留 {session().frameCount} 帧</div>
                    <div>已忽略 {session().duplicateCount ?? 0} 张重复画面</div>
                    <div>方向 {session().axis ?? "自动检测"}</div>
                    <div class="otter-capture-status-copy mt-1">{session().lastMessage ?? "请慢速向下滚动，Otter 会录制非重复画面，完成后统一拼接"}</div>
                    <div class="otter-capture-status-shortcut mt-2">Enter/Ctrl+3 完成，Esc 取消</div>
                </div>
            )}
        </Show>

        <div hidden aria-hidden="true" data-testid="otter-tea-automation-surface">
            <button
                type="button"
                data-testid="tea-ticket-button"
                onClick={() => void createTeaTicketFromCurrentOtterState("automation")}
            />
            <output data-testid="tea-ticket-output">
                {lastTeaTicket()?.id || lastTeaTicketError() || ""}
            </output>
        </div>

        <StickerContextMenuLayer />
        <ExtensionCommandPalette />

        <AppSettingsDialog
            open={appSettingsOpen()}
            settings={appSettings()}
            onClose={() => setAppSettingsOpen(false)}
            onSaved={setAppSettings}
        />

        <SurfaceConfirmationDialog
            request={surfaceConfirmations()[0]}
            submitting={surfaceConfirmationSubmitting()}
            error={surfaceConfirmationError()}
            onDecision={(approved) => void decideCurrentSurfaceConfirmation(approved)}
        />

        {/* DEBUG: Visual Mouse Tracker Removed */}
    </main>
    </ErrorBoundary>
  );
}
