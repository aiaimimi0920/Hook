import { onMount, onCleanup, createEffect, createSignal, Show, ErrorBoundary, untrack, batch } from "solid-js";
import { api, isTauriRuntimeAvailable, listenBrowserLoomHookMethod, type TeaTicketSummary, type VoiceSettingsSummary } from "./services/api";
import { listen } from "@tauri-apps/api/event";
import { installErrorDiagnostics } from "./services/errorDiagnostics";
import {
  hasActiveEditableShortcutTarget,
  hasFocusedDomShortcutOwner,
  installEditableFocusLifecycle,
  notifyNativeAppFocus,
} from "./services/editableFocus";
import { logger } from "./services/logger";

import "./app.css";

// Components
import { CanvasLinks } from "./components/CanvasLinks";
import { CanvasUnits } from "./components/CanvasUnits";
import { CanvasSelection } from "./components/CanvasSelection";
import { StickerGroupBar } from "./components/StickerGroupBar";
import { HistoryPanel } from "./components/HistoryPanel";
import { StickerContextMenuLayer } from "./components/StickerContextMenuLayer";
import { AppSettingsDialog } from "./components/AppSettingsDialog";
import { SurfaceConfirmationDialog } from "./components/SurfaceConfirmationDialog";
import { sanitizeHistoryState } from "./services/historyModel";
import { normalizeStickerToolSettings } from "./services/toolSettings";
import { addRecycleBinEntry, pruneRecycleBinEntries } from "./services/stickerLibraryModel";
import { captureFrozenStickerSnapshot } from "./services/stickerSnapshot";

// Stores & Services
import { graphStore } from "./store/graphStore";
import { SurfaceStateError, surfaceStore } from "./store/surfaceStore";
import { surfaceResourceStore } from "./store/surfaceResourceStore";
import { surfaceAttachmentRequests } from "./services/surfaceAttachmentRequests";
import {
    linkingState,
    setLinkingState,
    setMousePos,
    isSelecting,
    selectedStickerId,
    setSelectedStickerId,
    uiActions,
    setIsSelecting,
    isCleanView,
    setIsCleanView,
    selectedUnitIds,
    selectionActions,
    activeStickerEditTargetId,
    setActiveStickerEditTargetId,
    setCaptureMode,
    stickerToolSettings,
    selectedStickerAnnotationId,
    selectedStickerAnnotationIds,
    longCaptureSession,
    draggingStickerId,
    unitUiState,
} from "./store/uiStore";


import { loomHook } from "./services/client";
import { syncService } from "./services/syncService";
import { shaderCache } from "./services/shaderCache";
import {
    createOverlaySyntheticDispatcher,
    OVERLAY_GLOBAL_MOUSE_UP_EVENT,
    shouldResetOverlaySyntheticOnGlobalMouseUp,
    type OverlaySyntheticMousePayload,
} from "./services/overlaySyntheticEvents";
import { resolveCanvasDisplayImage } from "./services/graphImageResolution";
import {
    extractArtDeliveryValueOutputs,
    materializeSharedMemoryOutputs,
    mergeArtDeliveryOutputs,
} from "./services/artDeliveryOutputs";
import { extractArtDeliveryCandidatesState } from "./services/artDeliveryCandidates";
import {
    isRecoverableCandidateExecutionFailure,
    mergeCandidateRuntimeState,
    prefetchCandidateAssets,
} from "./services/artCandidateCache";
import {
  requiresFormalExecutionAfterPreview,
  supportsShaderPreview,
} from "./services/artCapabilities";
import {
    findArtCapability,
    findArtCapabilityAfterRefresh,
} from "./services/artCapabilityLookup";
import { resolveDeletionPlan } from "./services/deletionPlan";
import { composeTeaTicketText, summarizeUnitsForTea } from "./services/teaTicketText";
import type { BootProfile } from "./services/bootProfile";
import { captureStickerEditSnapshot } from "./services/stickerHistory";
import { removeAnnotationsByIds } from "./services/stickerAnnotationMutations";
import { stickerContextMenuController } from "./services/stickerContextMenuController";
import {
    beginCaptureSelectionState,
    resolveCaptureCtrlModifier,
    resolveShortcutContext,
    shouldStartCanvasSelectionFromTarget,
    type CaptureSelectionMode,
} from "./services/captureState";
import {
    normalizeWorkflowSnapshotPayload,
    type WorkflowSnapshotPayload,
} from "./services/workflowPayload";
import { normalizeImageSourceForDisplay } from "./services/imageSource";
import {
    getCurrentAppSettings,
    loadCurrentAppSettings,
    normalizeHookCacheSettings,
    saveCurrentAppSettings,
} from "./services/appSettings";
import { DEFAULT_APP_SETTINGS, type AppSettings, type HookCacheSettings } from "./types/appSettings";
import {
    buildWorkflowInstantiation,
    mergeInstantiatedLinks,
    mergeInstantiatedUnits,
} from "./services/workflowInstantiation";
import { refreshLoomHookCapabilitiesOnStartup } from "./services/loomHookStartup";
import { artExecutionRequests } from "./services/artExecutionRequests";
import {
    applyHookGeneralSettings,
    normalizeHookGeneralSettings,
} from "./services/hookGeneralSettings";
import {
    restoredSessionNeedsCapabilityRefresh,
    sessionSnapshotNeedsCapabilityRefresh,
} from "./services/restoredSessionCapabilities";

// Hooks
import { useDraggable } from "./hooks/useDraggable";
import { useSelection } from "./hooks/useSelection";
import { useShortcuts, checkDragModifier, ShortcutManager } from "./hooks/useShortcuts";
import { useLinking } from "./hooks/useLinking";
import { useUnitActions } from "./hooks/useUnitActions";
import { useClipboard } from "./hooks/useClipboard";
import { useFileDrop } from "./hooks/useFileDrop";
import type { ArtDelivery, ArtCapability } from "./services/protocol";
import {
    SURFACE_PROTOCOL_VERSION,
    type SurfaceConfirmationRequest,
    type SurfaceLifecycleState,
    type SurfacePortValue,
} from "./services/surfaceProtocol";
import type { Unit } from "./types/unit";

type VoiceStatus = "idle" | "recording" | "transcribing" | "completed" | "failed" | "cancelled" | "unknown";

type VoiceHotkeyPayload = {
    shortcut: string;
    event: unknown;
    kind: string;
    statusHint: string;
};

type HookCacheControlPayload = {
    action?: "settings" | "clearRecycleBin" | "clearReferenceLibrary";
    settings?: Partial<HookCacheSettings>;
};

type VoiceSessionPayload = {
    id: string;
    status: string;
    transcript?: string | null;
    outputText?: string | null;
    error?: string | null;
    sessionLogPath?: string | null;
};

const resolveVoiceHotkeyStatus = (payload: VoiceHotkeyPayload): VoiceStatus => {
    switch (payload.statusHint) {
        case "recording":
        case "transcribing":
        case "cancelled":
            return payload.statusHint;
        default:
            return "unknown";
    }
};

const resolveVoiceSessionStatus = (payload: VoiceSessionPayload): VoiceStatus => {
    switch (payload.status) {
        case "recording":
        case "transcribing":
        case "completed":
        case "failed":
        case "cancelled":
            return payload.status;
        default:
            return "unknown";
    }
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

export default function App() {
  let portsLayerRef: HTMLDivElement | undefined;
  let activeBootProfile: BootProfile | null = null;
  const tauriRuntime = isTauriRuntimeAvailable();
  const disposeEditableFocusLifecycle = installEditableFocusLifecycle();
  onCleanup(disposeEditableFocusLifecycle);
  if (tauriRuntime) {
      let focusPollInFlight = false;
      let lastNativeFocus: boolean | undefined;
      const pollNativeFocus = async () => {
          if (focusPollInFlight) return;
          focusPollInFlight = true;
          try {
              const focused = await api.hasForegroundWindow();
              if (focused !== lastNativeFocus) {
                  lastNativeFocus = focused;
                  notifyNativeAppFocus(focused);
              }
          } finally {
              focusPollInFlight = false;
          }
      };
      const nativeFocusPoll = window.setInterval(() => void pollNativeFocus(), 250);
      void pollNativeFocus();
      onCleanup(() => window.clearInterval(nativeFocusPoll));
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
          detail?.message ?? "Loom 与 Hook 同时修改了画布。请刷新后重试。",
      );
  };
  window.addEventListener("hook:session-revision-conflict", onSessionRevisionConflict);
  onCleanup(() => {
      window.removeEventListener("hook:session-revision-conflict", onSessionRevisionConflict);
  });

  const decideCurrentSurfaceConfirmation = async (approved: boolean) => {
      const current = surfaceConfirmations()[0];
      if (!current || surfaceConfirmationSubmitting()) return;
      setSurfaceConfirmationSubmitting(true);
      setSurfaceConfirmationError(undefined);
      try {
          await loomHook.decideSurfaceConfirmation({
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
  const { startDrag, handleDragMove, handleDragEnd } = useDraggable();
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
  } = useSelection();
  const { handleParamChange, handleDoubleClick, spawnConnectedNode, performOcrAction, toggleTranslationAction, propagateFromUnit } = useUnitActions();
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
  let nativeCapturePointerActive = false;
  let captureCtrlReleasedSinceStart = false;

  const isContextualShaderArt = (art: ArtCapability) =>
      supportsShaderPreview(art) &&
      ((art.params || []).some((param) => param.widget === "image_link" || param.id === "reference") ||
          (art.inputs || []).some((input) => input.name === "reference"));

  let lastStickerToolbarToggleAt = Number.NEGATIVE_INFINITY;
  const toggleStickerToolbarVisibility = () => {
      const now = performance.now();
      // A native global shortcut and the focused WebView can both observe the
      // same Ctrl+E. Treat that pair as one toggle while retaining the local
      // path as a fallback when native registration/focus routing misses it.
      if (now - lastStickerToolbarToggleAt < 250) return;
      lastStickerToolbarToggleAt = now;
      const stickerId = selectedStickerId();
      if (tauriRuntime) {
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

      uiActions.showStickerToolbar(stickerId);
      if (selectedUnit.type === "art") {
          uiActions.setStickerEditMode("select");
      }
  };

  const scheduleOverlayHitTestRefresh = (options: { forceClickThrough?: boolean } = {}) => {
      window.setTimeout(() => {
          void (async () => {
              if (options.forceClickThrough) {
                  await api.setOverlayClickThrough(true);
              }
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
      const snapshot =
          direction === "undo"
              ? uiActions.undoStickerHistory(id, current)
              : uiActions.redoStickerHistory(id, current);

      if (!snapshot) return;
      graphStore.actions.restoreStickerEditSnapshot(id, snapshot);
      graphStore.actions.propagateStickerEditsFrom(id);
      await syncService.performWorkflowSync();
  };

  const summarizeSelectedUnitsForTea = () => {
      const ids = selectedUnitIds.length > 0
          ? [...selectedUnitIds]
          : selectedStickerId()
              ? [selectedStickerId()!]
              : [];
      return summarizeUnitsForTea(graphStore.units, ids);
  };

  const buildTeaTicketText = (trigger: string) =>
      composeTeaTicketText({
          trigger,
          unitCount: graphStore.units.length,
          linkCount: graphStore.links.length,
          selectedSummary: summarizeSelectedUnitsForTea(),
          voiceOutput: lastVoiceSession()?.outputText || lastVoiceSession()?.transcript || "",
      });

  const createTeaTicketFromCurrentHookState = async (trigger = "panel") => {
      const selectedSummary = summarizeSelectedUnitsForTea();
      const voiceOutput = lastVoiceSession()?.outputText || lastVoiceSession()?.transcript || null;
      setLastTeaTicketError(null);

      try {
          const ticket = await api.createTeaTicket({
              source: "hook-desktop",
              text: buildTeaTicketText(trigger),
              context: {
                  active_window: null,
                  selection_text: selectedSummary || voiceOutput,
                  ocr_text: lastVoiceSession()?.transcript || null,
                  screenshot_ref: null,
                  cwd: null,
                  app: "hook",
              },
              attachments: [],
          });
          setLastTeaTicket(ticket);
          void api.debugLogEvent("tea-ticket-created", `id=${ticket.id} status=${ticket.status}`);
      } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setLastTeaTicketError(message);
          void api.debugLogEvent("tea-ticket-create-failed", message);
      }
  };

  let capabilityRefreshPromise: Promise<void> | null = null;
  const refreshCapabilities = async () => {
      if (capabilityRefreshPromise) return capabilityRefreshPromise;

      capabilityRefreshPromise = (async () => {
          const handshake = await loomHook.connect();
          const arts = handshake.capabilities.artDefinitions;
          graphStore.setCapabilities(arts);

          const shaderArts = arts.filter((art: ArtCapability) => supportsShaderPreview(art));
          shaderArts
              .filter((art) => !isContextualShaderArt(art))
              .forEach((art: ArtCapability) => {
                  void shaderCache.prefetchShader(art.id);
              });
      })();

      try {
          await capabilityRefreshPromise;
      } finally {
          capabilityRefreshPromise = null;
      }
  };

  const applyLoomManagedSettings = async (settings: unknown) => {
      if (!settings || typeof settings !== "object") return;
      ShortcutManager.applyLoomSettings(settings);
      const record = settings as Record<string, unknown>;
      applyHookGeneralSettings(normalizeHookGeneralSettings(
          record.hook_general,
      ));

      const hookCache = record.hookCache;
      if (!hookCache || typeof hookCache !== "object") return;
      const cache = normalizeHookCacheSettings(hookCache);
      const saved = await saveCurrentAppSettings({
          ...getCurrentAppSettings(),
          cache,
      });
      setAppSettings(saved);
      const pruned = pruneRecycleBinEntries(graphStore.recycleBin);
      if (pruned.length !== graphStore.recycleBin.length) {
          graphStore.setRecycleBin(pruned);
          await syncService.performWorkflowSync();
      }
  };

  const instantiateWorkflowSnapshot = async (payload: WorkflowSnapshotPayload) => {
      const result = buildWorkflowInstantiation(payload, {
          existingUnits: graphStore.units,
          capabilities: graphStore.capabilities,
          newId: () => crypto.randomUUID(),
      });
      if (!result) return;
      const { units: instantiatedUnits, links: instantiatedLinks, referencedLocalIds } = result;

      graphStore.setUnits((prev) => mergeInstantiatedUnits(prev, instantiatedUnits));
      graphStore.setLinks((prev) =>
          mergeInstantiatedLinks(prev, instantiatedLinks, referencedLocalIds),
      );
      graphStore.setUnitParams((prev) => {
          const next = { ...prev };
          instantiatedUnits.forEach((unit) => {
              next[unit.id] = unit.params || {};
          });
          return next;
      });
      graphStore.setUnitExecConfig((prev) => {
          const next = { ...prev };
          instantiatedUnits.forEach((unit) => {
              if (unit.data.executionConfig) {
                  next[unit.id] = unit.data.executionConfig;
              } else {
                  delete next[unit.id];
              }
          });
          return next;
      });

      selectionActions.clear();
      uiActions.setSelectedStickerAnnotation(null);
      await api.setMouseMonitorActive(true);
      await syncService.updateBackendRects();
      await syncService.performWorkflowSync();
  };

  const handleArtDelivery = async (delivery: ArtDelivery) => {
      const unitId = delivery.art_id;
      const phase = delivery.phase ?? "final";
      const sharedMemoryHandles = new Set<string>();
      const collectSharedMemoryHandle = (value: unknown) => {
          if (
              value &&
              typeof value === "object" &&
              (value as { type?: unknown }).type === "shared_memory" &&
              typeof (value as { handle?: unknown }).handle === "string" &&
              (value as { handle: string }).handle.startsWith("Loom_Buffer_")
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
          artExecutionRequests.isLatest(unitId, delivery.request_id) &&
          (delivery.generation === undefined ||
              artExecutionRequests.generation(unitId, delivery.request_id) === delivery.generation);
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
                  delivery.delivery.format !== "rgba8" ||
                  !delivery.delivery.handle?.startsWith("Loom_Buffer_") ||
                  typeof delivery.delivery.size !== "number" ||
                  !Number.isSafeInteger(delivery.delivery.size) ||
                  delivery.delivery.size <= 0 ||
                  typeof delivery.delivery.width !== "number" ||
                  !Number.isSafeInteger(delivery.delivery.width) ||
                  delivery.delivery.width <= 0 ||
                  typeof delivery.delivery.height !== "number" ||
                  !Number.isSafeInteger(delivery.delivery.height) ||
                  delivery.delivery.height <= 0
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
                  delivery.delivery.height
              );
              break;
          case "base64":
              previewSrc = delivery.delivery.data;
              break;
          case "file_path":
              filePath = delivery.delivery.path;
              if (filePath) {
                  previewSrc = normalizeImageSourceForDisplay(filePath);
              }
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

      const workflowPreviewSrc = artExecutionRequests.getPreview(
          unitId,
          delivery.request_id,
      );
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

  const transitionSurfaceLifecycle = async (
      unitId: string,
      state: SurfaceLifecycleState,
  ): Promise<void> => {
      const current = surfaceStore.byUnit[unitId];
      if (!current || current.lifecycle === "disposed" || current.lifecycle === state) return;
      const event = {
          protocolVersion: "loom.surface.v1" as const,
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
                  // A stale annotation selection must not fall through to unit
                  // deletion or create a no-op history/sync entry.
                  uiActions.setSelectedStickerAnnotation(null);
                  return;
              }
              uiActions.pushStickerHistory(plan.unitId, captureStickerEditSnapshot(activeUnit));
              graphStore.actions.updateStickerEditData(plan.unitId, {
                  annotationState: nextAnnotationState,
              });
              graphStore.actions.propagateStickerEditsFrom(plan.unitId);
              uiActions.setSelectedStickerAnnotation(null);
              void syncService.performWorkflowSync();
          }
          return;
      }

      if (plan.kind === "units") {
          const ids = plan.unitIds;
          ids.forEach((id) => {
              void transitionSurfaceLifecycle(id, "disposed");
          });
          const recycleEntries = ids
              .map((id) => graphStore.units.find((unit) => unit.id === id))
              .filter((unit): unit is Unit => !!unit && unit.type === "sticker")
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
              // Clear all per-unit UI state keyed by unit id so deleting a unit
              // does not leak history/panel/notice entries for its dead id.
              uiActions.clearStickerHistory(id);
              uiActions.clearUnitUiState(id);
              uiActions.dismissEnhancementNotice(id);
          });

          selectionActions.clear();
          uiActions.hideStickerToolbar();

          void syncService.updateBackendRects();
          void syncService.performWorkflowSync();
      }
  };

  // Edit an existing image: try clipboard first (image bytes or file path from
  // Explorer copy), create sticker, enter edit mode. Falls back to file dialog.
  const openImageForEdit = async () => {
      try {
          // Try clipboard first
          const clipboardData = await api.readClipboardImage();
          if (clipboardData) {
              const center = {
                  x: (typeof window !== "undefined" ? window.innerWidth : 800) / 2,
                  y: (typeof window !== "undefined" ? window.innerHeight : 600) / 2,
              };
              const stickerId = createImageUnit(clipboardData, center);
              if (stickerId) {
                  setActiveStickerEditTargetId(stickerId);
              }
              void syncService.performWorkflowSync();
              return;
          }

          // Fallback: file dialog
          const dataUrl = await api.openImageForEdit();
          if (!dataUrl) return;
          const center = {
              x: (typeof window !== "undefined" ? window.innerWidth : 800) / 2,
              y: (typeof window !== "undefined" ? window.innerHeight : 600) / 2,
          };
          const stickerId = createImageUnit(dataUrl, center);
          if (stickerId) {
              setActiveStickerEditTargetId(stickerId);
          }
          void syncService.performWorkflowSync();
      } catch (error) {
          console.error("Open image for edit failed", error);
          await api.debugLogEvent(
              "open-image-for-edit-failure",
              error instanceof Error ? error.message : String(error),
          );
      }
  };

  createEffect(() => {
      if (!tauriRuntime) return;
      void api.setOverlayKeyboardCaptureActive(Boolean(selectedStickerId()) && !isSelecting());
  });

  // Shortcuts
  useShortcuts({
      contextProvider: () => {
          return resolveShortcutContext({
              hasBlockingDialog: appSettingsOpen() || surfaceConfirmations().length > 0,
              hasActiveLongCapture: Boolean(longCaptureSession()?.active),
              isSelecting: isSelecting(),
              hasSelectedSticker: Boolean(selectedStickerId()),
              hasSelectedAnnotation:
                  selectedStickerAnnotationIds.length > 0 || Boolean(selectedStickerAnnotationId()),
              hasActiveStickerEditTarget: activeStickerEditTargetId() === selectedStickerId(),
              stickerEditingDomain: stickerToolSettings.domain,
              stickerTransformMode: stickerToolSettings.transformMode,
              stickerCanvasTool: stickerToolSettings.activeCanvasTool,
          });
      },
      handlers: {
          onCopy: handleCopy,
          onPaste: handlePaste,
          onSave: handleSave,
          onOpenImage: openImageForEdit,
          onToggleHistory: () => uiActions.toggleHistoryPanel(),
          onUndoEdit: () => applyStickerHistorySnapshot("undo"),
          onRedoEdit: () => applyStickerHistorySnapshot("redo"),
          onDelete: deleteSelectedUnitOrAnnotation,
          onCloseActions: closeSelectedActionsMenu,
          onCancelSelection: async () => {
              if (longCaptureSession()?.active) {
                  await cancelAutoLongCaptureSession();
                  return;
              }
              invalidateCaptureSessionLifecycle();
              nativeCapturePointerActive = false;
              captureCtrlReleasedSinceStart = false;
              await api.setCaptureInputActive(false);
              resetSelection();
              uiActions.setSelectedStickerAnnotation(null);
              if ((activeBootProfile?.initialUiMode || "overlay") === "canvas" && graphStore.units.length > 0) {
                  await api.showCanvasWindow();
              } else if ((activeBootProfile?.initialUiMode || "overlay") === "tray" && graphStore.units.length === 0) {
                  await api.hideToTray();
              } else {
                  await api.showOverlayHost(true);
                  if (graphStore.units.length > 0) {
                      await api.setMouseMonitorActive(true);
                      await syncService.updateBackendRects();
                  }
              }
          },
          onCancelStickerEdit: () => {
              uiActions.requestStickerEditCancel();
          },
          onToggleStickerToolbar: () => {
              toggleStickerToolbarVisibility();
          },
          onToggleActions: () => {
              const id = selectedStickerId();
              if (id) {
                  // Re-pull arts from Loom each time the add-node menu opens, so
                  // tools registered/wrapped after Hook started (or before the
                  // Loom daemon was ready at handshake time) still show up.
                  void refreshCapabilities();
                  uiActions.toggleActions(id);
                  scheduleOverlayHitTestRefresh();
              }
          },
          onToggleParams: () => {
              const id = selectedStickerId();
              if (id) {
                  uiActions.toggleParams(id);
                  scheduleOverlayHitTestRefresh();
              }
          },
          onToggleCleanView: () => {
              logger.debug("Toggle Clean View Mode");
              setIsCleanView(!isCleanView());
          },
          onTransformSelect: () => {
              if (selectedStickerId()) {
                  uiActions.setStickerTransformMode("select");
              }
          },
          onTransformMove: () => {
              if (selectedStickerId()) {
                  uiActions.setStickerTransformMode("move");
              }
          },
          onTransformRotate: () => {
              if (selectedStickerId()) {
                  uiActions.setStickerTransformMode("rotate");
              }
          },
          onTransformScale: () => {
              if (selectedStickerId()) {
                  uiActions.setStickerTransformMode("scale");
              }
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
                          await refreshCapabilities();
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

              const nodeId = spawnConnectedNode(sourceId, capability.id);
              if (!nodeId) return;
              void api.debugLogEvent(
                  "quick-art-node-created",
                  `source=${sourceId} node=${nodeId} requested=${artId} resolved=${capability.id}`,
              );
          },
          onToggleOcr: async () => {
               // OCR Logic moved to centralized handler or here (it's small)
               const id = selectedStickerId();
               if (!id) return;
               logger.debug("Triggering OCR explicitly...");
               await api.triggerOcrEvent();

          },
          onToggleTranslation: async () => {
               const id = selectedStickerId();
               if (!id) return;
               await toggleTranslationAction(id);
          }
      }
  });

  const beginCaptureSelection = async (mode: CaptureSelectionMode) => {
      const captureStart = beginCaptureSelectionState(mode, isSelecting());
      if (!captureStart.shouldStart) {
          void api.debugLogEvent(captureStart.duplicateDebugEvent);
          return;
      }

      beginCaptureSessionLifecycle();
      nativeCapturePointerActive = false;
      captureCtrlReleasedSinceStart = false;
      overlaySynthetic.reset();
      resetSelection();
      setCaptureMode(captureStart.captureMode);
      setIsSelecting(true);
      let initialCapturePoint: { x: number; y: number } | null = null;
      try {
          const cursor = await api.getCaptureCursorPosition();
          initialCapturePoint = { x: cursor.x, y: cursor.y };
          setMousePos(initialCapturePoint);
      } catch {
          // Best-effort only; backend global mouse_move will refresh this immediately.
      }
      await prepareCaptureWindowTargets(initialCapturePoint);
      await api.setMouseMonitorActive(false);
      await api.setCaptureInputActive(true);
      await api.setOverlayClickThrough(true);
  };

  // Initialization
  onMount(async () => {
      logger.debug("App Mounted - Initializing...");
      const cleanups: Array<() => void> = [];
      const tauriRuntimeAvailable = tauriRuntime;
      let bootProfile: BootProfile | null = null;

      let onWindowMouseMove: ((e: MouseEvent) => void) | null = null;
      let onWindowMouseUp: ((e: MouseEvent) => void) | null = null;

      // Global error diagnostics (localStorage + on-screen overlay + best-effort
      // IPC) live in a dedicated module so they survive a synchronous webview
      // crash. installErrorDiagnostics returns a disposer for the listeners.
      cleanups.push(installErrorDiagnostics(tauriRuntimeAvailable));

      if (tauriRuntimeAvailable) {
          void api.debugLogEvent("frontend-mounted");
      }

      try {
          bootProfile = await api.getBootProfile();
          activeBootProfile = bootProfile;
          if (tauriRuntimeAvailable) {
              void api.debugLogEvent(
                  "boot-profile-loaded",
                  `startupMode=${bootProfile.startupMode} initialUiMode=${bootProfile.initialUiMode} autoStartCapture=${bootProfile.autoStartCapture} loomHookEnabled=${bootProfile.loomHookEnabled}`,
              );
          }
      } catch (error) {
          console.warn("Failed to load boot profile, falling back to defaults:", error);
          if (tauriRuntimeAvailable) {
              void api.debugLogEvent(
                  "boot-profile-failed",
                  error instanceof Error ? error.message : String(error),
              );
          }
      }

      try {
          const settings = await api.getVoiceSettingsSummary();
          setVoiceSettings(settings);
          if (tauriRuntimeAvailable) {
              void api.debugLogEvent(
                  "voice-settings-loaded",
                  `shortcut=${settings.shortcut} trigger=${settings.triggerMode} audio=${settings.audioBackend} provider=${settings.providerKind} output=${settings.outputMode}`,
              );
          }
      } catch (error) {
          console.warn("Failed to load voice settings summary:", error);
          if (tauriRuntimeAvailable) {
              void api.debugLogEvent(
                  "voice-settings-failed",
                  error instanceof Error ? error.message : String(error),
              );
          }
      }

      try {
          const toolSettingsData = await api.loadToolSettings();
          if (toolSettingsData?.stickerToolSettings) {
              uiActions.setStickerToolSettings(
                  normalizeStickerToolSettings(toolSettingsData.stickerToolSettings as Record<string, unknown>),
              );
          }
      } catch (error) {
          console.warn("Failed to load sticker tool settings:", error);
      }

      try {
          setAppSettings(await loadCurrentAppSettings());
      } catch (error) {
          console.warn("Failed to load app settings:", error);
      }

      if (tauriRuntimeAvailable) {
          // Register desktop listeners before handshake/session restore,
          // otherwise the first instantiate broadcast can arrive before the UI is listening.
          const unlistenOcr = await listen("trigger-ocr", async () => {
              logger.debug("Backend Triggered OCR");
              const id = selectedStickerId();
              if (id) {
                  await performOcrAction(id);
              }
          });

          const unlistenCapture = await listen("trigger-capture", () => {
              logger.debug("Backend Triggered Capture Mode");
              void api.debugLogEvent("trigger-capture-listener");
              setAppSettingsOpen(false);
              void beginCaptureSelection("region");
          });

          const unlistenLongCapture = await listen("trigger-long-capture", () => {
              logger.debug("Backend Triggered Long Capture Mode");
              void api.debugLogEvent("trigger-long-capture-listener");
              setAppSettingsOpen(false);
              if (longCaptureSession()?.active) {
                  void finishAutoLongCaptureSession();
                  return;
              }
              void beginCaptureSelection("long-vertical");
          });

          const unlistenLongCaptureFinish = await listen("trigger-long-capture-finish", () => {
              void api.debugLogEvent("trigger-long-capture-finish-listener");
              if (longCaptureSession()?.active) {
                  void finishAutoLongCaptureSession();
              }
          });

          const unlistenLongCaptureWheel = await listen<{ deltaX?: number; deltaY?: number }>("trigger-long-capture-wheel", (event) => {
              if (!longCaptureSession()?.active) return;
              void notifyAutoLongCaptureWheel({
                  deltaX: event.payload?.deltaX,
                  deltaY: event.payload?.deltaY,
              });
          });

          const unlistenStickerToolbar = await listen("trigger-toggle-sticker-toolbar", () => {
              logger.debug("Backend Triggered Sticker Toolbar Toggle");
              void api.debugLogEvent("trigger-toggle-sticker-toolbar-listener");
              toggleStickerToolbarVisibility();
          });

          const unlistenOpenImage = await listen("trigger-open-image", () => {
              void api.debugLogEvent("trigger-open-image-listener");
              void openImageForEdit();
          });

          const unlistenAppSettings = await listen("trigger-open-app-settings", () => {
              void api.debugLogEvent("trigger-open-app-settings-listener");
              setAppSettingsOpen(true);
          });

          const unlistenCopy = await listen("trigger-copy", () => {
              void api.debugLogEvent("trigger-copy-listener");
              if (!selectedStickerId()) return;
              void handleCopy();
          });

          const unlistenPaste = await listen("trigger-paste", () => {
              void api.debugLogEvent("trigger-paste-listener");
              if (!selectedStickerId()) return;
              void handlePaste();
          });

          // The native overlay keyboard hook forwards sticker-selected DOM
          // shortcuts (Tab, Shift+1, ...) here when the webview lacks OS keyboard
          // focus, so they work without the overlay stealing foreground focus.
          // Replay them as a synthetic keydown into the normal ShortcutManager path.
          const unlistenOverlayShortcut = await listen<{
              key: string;
              ctrlKey: boolean;
              shiftKey: boolean;
              altKey: boolean;
              metaKey?: boolean;
          }>("overlay/global_shortcut", (event) => {
              const payload = event.payload;
              if (!payload?.key) return;
              window.dispatchEvent(
                  new KeyboardEvent("keydown", {
                      key: payload.key,
                      ctrlKey: !!payload.ctrlKey,
                      shiftKey: !!payload.shiftKey,
                      altKey: !!payload.altKey,
                      metaKey: !!payload.metaKey,
                      bubbles: true,
                      cancelable: true,
                  }),
              );
          });

          const unlistenWindowFocus = await listen<boolean>("hook/window_focus_changed", (event) => {
              // The native event is immediate; polling is intentionally only a
              // fallback because WebView timers can be throttled after focus loss.
              notifyNativeAppFocus(event.payload);
          });

           const unlistenCreateTeaTicket = await listen("trigger-create-tea-ticket", () => {
               untrack(() => {
                   logger.debug("Backend Triggered Tea Ticket Creation");
                   void api.debugLogEvent("trigger-create-tea-ticket-listener");
                   void createTeaTicketFromCurrentHookState("tray");
               });
           });

           const unlistenVoiceHotkey = await listen<VoiceHotkeyPayload>("voice-hotkey-event", (event) => {
               setLastVoiceHotkey(event.payload);
               setVoiceStatus(resolveVoiceHotkeyStatus(event.payload));
              void api.debugLogEvent(
                  "voice-hotkey-listener",
                  `kind=${event.payload.kind} status=${event.payload.statusHint}`,
              );
          });

          const unlistenVoiceSession = await listen<VoiceSessionPayload>("voice-session-event", (event) => {
              setLastVoiceSession(event.payload);
              setVoiceStatus(resolveVoiceSessionStatus(event.payload));
              void api.debugLogEvent(
                  "voice-session-listener",
                  `id=${event.payload.id} status=${event.payload.status}`,
              );
          });

          // eslint-disable-next-line solid/reactivity -- Tauri listener runs outside any tracking scope; the signal reads intentionally sample the state at event time.
          const unlistenEscape = await listen("trigger-escape", () => {
              void api.debugLogEvent("trigger-escape-listener");
              if (surfaceConfirmations().length > 0) {
                  void decideCurrentSurfaceConfirmation(false);
                  return;
              }
              if (appSettingsOpen()) {
                  setAppSettingsOpen(false);
                  return;
              }
              // When the WebView has focus, the DOM keydown path already owns
              // this physical key. Ignore rdev's native echo so one keypress
              // cannot delete an annotation and then its containing unit.
              if (hasFocusedDomShortcutOwner()) {
                  return;
              }
              if (longCaptureSession()?.active) {
                  void cancelAutoLongCaptureSession();
                  return;
              }
              if (isSelecting()) {
                  invalidateCaptureSessionLifecycle();
                  nativeCapturePointerActive = false;
                  captureCtrlReleasedSinceStart = false;
                  void (async () => {
                      await api.setCaptureInputActive(false);
                      resetSelection();
                      await api.setOverlayClickThrough(true);
                      if (graphStore.units.length > 0) {
                          await api.setMouseMonitorActive(true);
                          await syncService.updateBackendRects();
                      }
                  })();
                  return;
              }
              if (hasActiveEditableShortcutTarget()) {
                  return;
              }
              if (closeSelectedActionsMenu()) {
                  return;
              }
              if (selectedStickerId()) {
                  deleteSelectedUnitOrAnnotation();
              }
          });

          // eslint-disable-next-line solid/reactivity -- Tauri listener runs outside any tracking scope; the signal reads intentionally sample the state at event time.
          const unlistenDelete = await listen("trigger-delete", () => {
              void api.debugLogEvent("trigger-delete-listener");
              if (activeBootProfile?.nativeAcceptance) {
                  return;
              }
              if (hasFocusedDomShortcutOwner()) {
                  return;
              }
              if (
                  appSettingsOpen()
                  || surfaceConfirmations().length > 0
                  || longCaptureSession()?.active
                  || isSelecting()
                  || hasActiveEditableShortcutTarget()
              ) {
                  return;
              }
              if (!selectedStickerId()) {
                  return;
              }
              deleteSelectedUnitOrAnnotation();
          });

          // Create a minimal MouseEvent-compatible object for capture events
          type NativeCaptureMousePayload = {
              x?: number;
              y?: number;
              shiftKey?: boolean;
              ctrlKey?: boolean;
          };
          const toCaptureMouseEvent = (payload: NativeCaptureMousePayload): Pick<MouseEvent, "clientX" | "clientY" | "shiftKey" | "ctrlKey" | "target"> => {
              const ctrlModifier = resolveCaptureCtrlModifier(
                  captureCtrlReleasedSinceStart,
                  !!payload?.ctrlKey,
              );
              captureCtrlReleasedSinceStart = ctrlModifier.releasedSinceCaptureStart;
              return {
                  clientX: payload?.x ?? 0,
                  clientY: payload?.y ?? 0,
                  shiftKey: !!payload?.shiftKey,
                  ctrlKey: ctrlModifier.effectiveCtrlKey,
                  target: document.getElementById("app-main") as HTMLElement,
              };
          };

          const toOverlayDragMouseEvent = (payload: OverlaySyntheticMousePayload) =>
              new MouseEvent("mousemove", {
                  clientX: payload.x ?? payload.globalX ?? 0,
                  clientY: payload.y ?? payload.globalY ?? 0,
                  screenX: payload.globalX ?? payload.x ?? 0,
                  screenY: payload.globalY ?? payload.y ?? 0,
                  ctrlKey: !!payload.ctrlKey,
                  altKey: !!payload.altKey,
                  shiftKey: !!payload.shiftKey,
                  metaKey: !!payload.metaKey,
                  buttons: 1,
              });

          const unlistenCaptureDown = await listen<NativeCaptureMousePayload>(
              "capture/global_mouse_down",
              (event) => {
                  if (!isSelecting() || nativeCapturePointerActive) return;
                  nativeCapturePointerActive = true;
                  const captureEvent = toCaptureMouseEvent(event.payload);
                  setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });
                  handleSelectionStart(captureEvent);
              },
          );

          const unlistenCaptureMove = await listen<NativeCaptureMousePayload>(
              "capture/global_mouse_move",
              (event) => {
                  if (!isSelecting()) return;
                  const captureEvent = toCaptureMouseEvent(event.payload);
                  setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });
                  handleSelectionMove(captureEvent);
              },
          );

          const unlistenCaptureUp = await listen<NativeCaptureMousePayload>("capture/global_mouse_up", (event) => {
              if (!isSelecting() || !nativeCapturePointerActive) return;
              nativeCapturePointerActive = false;
              const captureEvent = toCaptureMouseEvent(event.payload);
              setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });
              handleSelectionMove(captureEvent);
              handleSelectionEnd(captureEvent);
              captureCtrlReleasedSinceStart = false;
          });

          const unlistenOverlayMouseDown = await listen<OverlaySyntheticMousePayload>(
              "overlay/global_mouse_down",
              (event) => {
                  if (event.payload?.nativeDragPreflight) {
                      window.dispatchEvent(
                          new CustomEvent("hook:overlay-native-drag-preflight-down", {
                              detail: event.payload,
                          }),
                      );
                  } else {
                      overlaySynthetic.dispatch("mousedown", event.payload);
                  }
              },
          );

          const unlistenOverlayMouseMove = await listen<OverlaySyntheticMousePayload>(
              "overlay/global_mouse_move",
              (event) => {
                  if (event.payload?.nativeDragPreflight) {
                      window.dispatchEvent(
                          new CustomEvent("hook:overlay-native-drag-preflight-move", {
                              detail: event.payload,
                          }),
                      );
                  } else if (draggingStickerId()) {
                      // Whole-sticker dragging already has a pinned target. Feed the
                      // native sample directly into the compositor fast path instead
                      // of constructing pointer + mouse events and bubbling them
                      // through the DOM before the sticker can move.
                      handleDragMove(toOverlayDragMouseEvent(event.payload));
                  } else {
                      overlaySynthetic.dispatch("mousemove", event.payload);
                  }
              },
          );

          const unlistenOverlayMouseUp = await listen<OverlaySyntheticMousePayload>(
              "overlay/global_mouse_up",
              (event) => {
                  if (event.payload?.nativeDragPreflight) {
                      window.dispatchEvent(
                          new CustomEvent("hook:overlay-native-drag-preflight-up", {
                              detail: event.payload,
                          }),
                      );
                  } else {
                      window.dispatchEvent(new CustomEvent(OVERLAY_GLOBAL_MOUSE_UP_EVENT, {
                          detail: event.payload,
                      }));
                      overlaySynthetic.dispatch("mouseup", event.payload);
                  }
              },
          );

          const unlistenOverlayMouseWheel = await listen<OverlaySyntheticMousePayload>(
              "overlay/global_mouse_wheel",
              (event) => {
                  overlaySynthetic.dispatch("wheel", event.payload);
              },
          );

          const unlistenOverlayContextMenu = await listen<OverlaySyntheticMousePayload>(
              "overlay/global_context_menu",
              (event) => {
                  overlaySynthetic.dispatch("contextmenu", event.payload);
              },
          );

          const unlistenInstantiate = await listen("art/instantiate", async (event) => {
              logger.debug("Received workflow instantiation payload");
              await instantiateWorkflowSnapshot(normalizeWorkflowSnapshotPayload(event.payload));
          });

          const unlistenCapabilitiesUpdated = await listen("art/capabilities_updated", async () => {
              logger.debug("Capabilities changed, refreshing handshake state");
              try {
                  await refreshCapabilities();
              } catch (e) {
                  console.error("Failed to refresh capabilities", e);
              }
          });

          const unlistenHookCacheControl = await listen<HookCacheControlPayload>(
              "hook/cache_control",
              async (event) => {
                  const action = event.payload?.action;
                  if (action === "settings" && event.payload.settings) {
                      const cache = normalizeHookCacheSettings(event.payload.settings);
                      const saved = await saveCurrentAppSettings({
                          ...getCurrentAppSettings(),
                          cache,
                      });
                      setAppSettings(saved);
                      const pruned = pruneRecycleBinEntries(graphStore.recycleBin);
                      if (pruned.length !== graphStore.recycleBin.length) {
                          graphStore.setRecycleBin(pruned);
                          await syncService.performWorkflowSync();
                      }
                      return;
                  }
                  if (action === "clearRecycleBin") {
                      graphStore.setRecycleBin([]);
                      await syncService.performWorkflowSync();
                      return;
                  }
                  if (action === "clearReferenceLibrary") {
                      graphStore.setReferenceLibrary([]);
                      await syncService.performWorkflowSync();
                  }
              },
          );

          const unlistenHookSettings = await listen<{ settings?: unknown }>(
              "hook/settings_updated",
              async (event) => {
                  await applyLoomManagedSettings(event.payload?.settings);
              },
          );
          const initialLoomSettings = await api.getLoomShortcutSettings();
          await applyLoomManagedSettings(initialLoomSettings);

          const unlistenConnectionState = await listen<{ connected?: boolean }>(
              "art/loom_connection_state",
              async (event) => {
                  if (event.payload?.connected) {
                      logger.debug("Loom Hook desktop bridge connected, refreshing capabilities");
                      try {
                          await refreshCapabilities();
                      } catch (e) {
                          console.error("Failed to refresh capabilities after reconnect", e);
                      }
                  } else {
                      console.warn("Loom Hook desktop bridge disconnected");
                  }
              },
          );
          const onSurfaceVisibilityChange = () => {
              const state: SurfaceLifecycleState = document.hidden ? "suspended" : "active";
              for (const unitId of Object.keys(surfaceStore.byUnit)) {
                  void transitionSurfaceLifecycle(unitId, state);
              }
          };
          document.addEventListener("visibilitychange", onSurfaceVisibilityChange);
          cleanups.push(() => {
              document.removeEventListener("visibilitychange", onSurfaceVisibilityChange);
          });

          const unlistenProgress = await loomHook.listenForProgress((artId, progress, requestId) => {
              if (requestId && !artExecutionRequests.isLatest(artId, requestId)) {
                  return;
              }
              graphStore.actions.updateUnitData(artId, {
                  processing: true,
                  nodeStatus: "running",
                  progress,
              });
          });

          const unlistenDelivery = await loomHook.listenForDelivery((delivery) => {
              handleArtDelivery(delivery).catch((error) => {
                  console.error("Failed to process art delivery", error);
                  if (!artExecutionRequests.isLatest(delivery.art_id, delivery.request_id)) {
                      return;
                  }
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
          });

          const surfaceRemountsInFlight = new Set<string>();
          const unlistenSurfaceReset = await loomHook.listenForSurfaceReset(() => {
              surfaceRemountsInFlight.clear();
              setSurfaceConfirmations([]);
              surfaceStore.actions.clearAll();
              surfaceResourceStore.actions.clearAll();
              surfaceAttachmentRequests.clearAll();
          });

          const unlistenSurfaceSnapshot = await loomHook.listenForSurfaceSnapshot((delivery) => {
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
          });

          const unlistenSurfacePatch = await loomHook.listenForSurfacePatch((delivery) => {
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
          });

          const unlistenSurfaceGeneration = await loomHook.listenForSurfaceGeneration((delivery) => {
              const current = surfaceStore.byUnit[delivery.hookNodeId];
              if (
                  current?.snapshot.instanceId === delivery.instanceId &&
                  current.snapshot.attachmentId === delivery.attachmentId
              ) {
                  surfaceStore.actions.setGeneration(delivery.hookNodeId, delivery.generation);
              }
          });

          const surfaceUnitIdForInstance = (instanceId: string): string | undefined =>
              Object.entries(surfaceStore.byUnit).find(
                  ([, state]) => state?.snapshot.instanceId === instanceId,
              )?.[0];

          const unlistenSurfaceActionAck = await loomHook.listenForSurfaceActionAck((ack) => {
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
          });

          const unlistenSurfaceConfirmation = await loomHook.listenForSurfaceConfirmation((request) => {
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
          });

          const unlistenSurfaceProgress = await loomHook.listenForSurfaceProgress((progress) => {
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
          });

          const unlistenSurfacePreview = await loomHook.listenForSurfacePreview((delivery) => {
              if (!surfaceStore.actions.acceptPreviewCommit(delivery.hookNodeId, delivery.commit)) {
                  return;
              }
              const previewSrc = surfacePreviewSource(delivery.commit.value);
              if (!previewSrc) return;
              graphStore.actions.updateUnitData(delivery.hookNodeId, {
                  previewSrc,
                  processing: true,
                  nodeStatus: "running",
                  errorMessage: undefined,
              });
          });

          const unlistenSurfaceResult = await loomHook.listenForSurfaceResult((delivery) => {
              if (!surfaceStore.actions.acceptResultCommit(delivery.hookNodeId, delivery.commit)) {
                  return;
              }
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
          });

          const unlistenSurfaceFailure = await loomHook.listenForSurfaceFailure((delivery) => {
              const unitId = delivery.hookNodeId
                  ?? surfaceUnitIdForInstance(delivery.failure.instanceId);
              const current = unitId ? surfaceStore.byUnit[unitId] : undefined;
              if (!unitId || !current || current.generation !== delivery.failure.generation) return;
              graphStore.actions.updateUnitData(unitId, {
                  processing: false,
                  nodeStatus: "error",
                  errorMessage: delivery.failure.error.message,
              });
          });

          const unlistenSurfaceLifecycle = await loomHook.listenForSurfaceLifecycle((delivery) => {
              const applied = surfaceStore.actions.applyLifecycle(
                  delivery.hookNodeId,
                  delivery.event,
              );
              if (applied && delivery.event.state === "disposed") {
                  setSurfaceConfirmations((requests) => requests.filter((request) =>
                      request.instanceId !== delivery.event.instanceId
                      || request.attachmentId !== delivery.event.attachmentId));
                  surfaceStore.actions.clear(delivery.hookNodeId);
                  surfaceAttachmentRequests.clear(delivery.hookNodeId);
              }
          });

          const unlistenSurfaceDispose = await loomHook.listenForSurfaceDispose((delivery) => {
              const current = surfaceStore.byUnit[delivery.hookNodeId];
              if (
                  current?.snapshot.instanceId === delivery.instanceId &&
                  current.snapshot.attachmentId === delivery.attachmentId
              ) {
                  setSurfaceConfirmations((requests) => requests.filter((request) =>
                      request.instanceId !== delivery.instanceId
                      || request.attachmentId !== delivery.attachmentId));
                  surfaceStore.actions.clear(delivery.hookNodeId);
              }
          });

          const unlistenSurfaceResource = await loomHook.listenForSurfaceResource((delivery) => {
              if (!surfaceResourceStore.actions.complete(
                  delivery.resourceId,
                  delivery.dataUrl,
                  delivery.expiresAtMs,
              )) {
                  surfaceResourceStore.actions.fail(delivery.resourceId);
                  console.warn("Ignoring invalid or expired Surface resource", delivery.resourceId);
              }
          });

          cleanups.push(
              unlistenOcr,
              unlistenCapture,
              unlistenLongCapture,
              unlistenLongCaptureFinish,
              unlistenLongCaptureWheel,
              unlistenStickerToolbar,
              unlistenOpenImage,
              unlistenAppSettings,
              unlistenCopy,
              unlistenPaste,
              unlistenOverlayShortcut,
              unlistenWindowFocus,
               unlistenCreateTeaTicket,
               unlistenVoiceHotkey,
               unlistenVoiceSession,
              unlistenEscape,
              unlistenDelete,
              unlistenCaptureDown,
              unlistenCaptureMove,
              unlistenCaptureUp,
              unlistenOverlayMouseDown,
              unlistenOverlayMouseMove,
              unlistenOverlayMouseUp,
              unlistenOverlayMouseWheel,
              unlistenOverlayContextMenu,
              unlistenInstantiate,
              unlistenCapabilitiesUpdated,
              unlistenHookCacheControl,
              unlistenHookSettings,
              unlistenConnectionState,
              unlistenProgress,
              unlistenDelivery,
              unlistenSurfaceReset,
              unlistenSurfaceSnapshot,
              unlistenSurfacePatch,
              unlistenSurfaceGeneration,
              unlistenSurfaceActionAck,
              unlistenSurfaceConfirmation,
              unlistenSurfaceProgress,
              unlistenSurfacePreview,
              unlistenSurfaceResult,
              unlistenSurfaceFailure,
              unlistenSurfaceLifecycle,
              unlistenSurfaceDispose,
              unlistenSurfaceResource,
          );

          onWindowMouseMove = (e: MouseEvent) => {
              handleGlobalMouseMove(e);
          };

          onWindowMouseUp = (e: MouseEvent) => {
              handleGlobalMouseUp(e);
          };

          window.addEventListener("mousemove", onWindowMouseMove);
          window.addEventListener("mouseup", onWindowMouseUp);
      }

      try {
          await refreshLoomHookCapabilitiesOnStartup(
              bootProfile?.loomHookEnabled ?? false,
              refreshCapabilities,
          );
      } catch (e) {
          console.warn("Loom Hook bridge unavailable during startup; continuing in standalone mode.", e);
      }

      let preloadedSession: Awaited<ReturnType<typeof api.loadSession>> | null = null;
      try {
          const preloadedSessionData = await api.loadSession();
          preloadedSession = preloadedSessionData;
          if (sessionSnapshotNeedsCapabilityRefresh(preloadedSessionData?.stickers, graphStore.capabilities)) {
              try {
                  await refreshCapabilities();
              } catch (error) {
                  console.warn("Failed to preflight restored-session art capabilities:", error);
              }
          }
      } catch (error) {
          console.warn("Failed to preflight persisted session before restore:", error);
      }

      await syncService.restoreSession(bootProfile || undefined, preloadedSession);
      const retainedRecycleEntries = pruneRecycleBinEntries(graphStore.recycleBin);
      if (retainedRecycleEntries.length !== graphStore.recycleBin.length) {
          graphStore.setRecycleBin(retainedRecycleEntries);
          await syncService.performWorkflowSync();
      }

      // A restored session can already contain installed Art nodes even when the
      // boot profile keeps Loom Hook's startup handshake disabled. Without a
      // capability refresh those nodes still restore as `type: "art"`, but they
      // boot without their catalog metadata and degrade into generic image nodes
      // until the user manually opens the add-node menu. Reload the catalog
      // immediately so restored shader/MCP/cloud Art nodes keep their true Hook
      // behavior after restart.
      if (restoredSessionNeedsCapabilityRefresh(graphStore.units, graphStore.capabilities)) {
          try {
              await refreshCapabilities();
              await syncService.restoreSession(bootProfile || undefined);
          } catch (error) {
              console.warn("Failed to refresh restored-session art capabilities:", error);
          }
      }
      uiActions.retainUnitScopedState(new Set(graphStore.units.map((unit) => unit.id)));

      // Load persisted color/screenshot history (best-effort; never blocks boot).
      try {
          const rawHistory = await api.loadHistory();
          uiActions.setHistoryState(sanitizeHistoryState(rawHistory));
      } catch (error) {
          console.warn("Failed to load history; starting with empty history.", error);
      }

      if (bootProfile?.autoStartCapture) {
          await api.debugLogEvent("boot-autostart-capture");
          await api.triggerCaptureMode();
      }

      if (!tauriRuntimeAvailable) {
          logger.debug("Running in browser preview mode; attaching browser IPC listeners.");
          const stopInstantiate = listenBrowserLoomHookMethod("loom.hook.workflow.instantiated", (payload) => {
              instantiateWorkflowSnapshot(normalizeWorkflowSnapshotPayload(payload)).catch((error) => {
                  console.error("Browser instantiate handler failed:", error);
              });
          });
          const stopCapabilitiesUpdated = listenBrowserLoomHookMethod("loom.hook.capabilities.updated", async () => {
              try {
                  await refreshCapabilities();
              } catch (error) {
                  console.error("Failed to refresh browser preview capabilities:", error);
              }
          });
          onCleanup(() => {
              stopInstantiate();
              stopCapabilitiesUpdated();
          });
          return;
      }

      await api.debugLogEvent(
          "frontend-initialized",
          `capabilities=${graphStore.capabilities.length} units=${graphStore.units.length}`,
      );

      onCleanup(() => {
          cleanups.forEach((fn) => fn());
          surfaceResourceStore.actions.clearAll();
          if (onWindowMouseMove) {
              window.removeEventListener("mousemove", onWindowMouseMove);
          }
          if (onWindowMouseUp) {
              window.removeEventListener("mouseup", onWindowMouseUp);
          }
      });
  });

  // NEW: Automatic Backend Sync when UI Layout Changes (Units or Panels)
  // We use createEffect to track signal dependencies accessed in updateBackendRects
  createEffect(() => {
      // Access signals to subscribe (implicit in updateBackendRects, but we make it explicit for clarity if needed)
      // data: graphStore.units, extraRects()
      syncService.updateBackendRects();
  });

  createEffect(() => {
      if (!isSelecting() && !longCaptureSession()?.active) {
          return;
      }

      stickerContextMenuController.close();
  });

  // Global Event Handlers
  const handledGlobalMouseMoveEvents = new WeakSet<Event>();
  const handledGlobalMouseUpEvents = new WeakSet<Event>();

  const handleGlobalMouseMove = (e: MouseEvent) => {
      if (handledGlobalMouseMoveEvents.has(e)) return;
      handledGlobalMouseMoveEvents.add(e);
      // The Windows overlay hook is the authoritative stream during a desktop
      // sticker drag because it continues outside the current DOM hit target.
      // Ignoring simultaneous trusted WebView moves prevents two differently
      // timed cursor streams from alternating the transient transform.
      if (tauriRuntime && draggingStickerId() && e.isTrusted) return;
      if (!draggingStickerId()) {
          setMousePos({ x: e.clientX, y: e.clientY });
      }
      if (!overlaySynthetic.moveRelayActive && !draggingStickerId()) {
          overlaySynthetic.relayPointerMove(e);
      }
      handleDragMove(e);
      if (!tauriRuntime || !isSelecting()) {
          handleSelectionMove(e);
      }
  };

  const handleGlobalMouseUp = (e: MouseEvent) => {
      if (handledGlobalMouseUpEvents.has(e)) return;
      handledGlobalMouseUpEvents.add(e);
      if (tauriRuntime && draggingStickerId() && e.isTrusted) return;
      // The reliable native Up carries the final cursor coordinates. Apply it
      // before ending the drag so a fast release cannot strand the sticker at
      // the previous coalesced/RAF move position.
      handleDragMove(e);
      handleDragEnd();
      // Desktop capture has a dedicated native pointer stream. A stale overlay
      // synthetic mouseup must not terminate the current capture selection.
      if (!tauriRuntime || !isSelecting()) {
          handleSelectionEnd(e);
      }
      if (shouldResetOverlaySyntheticOnGlobalMouseUp(tauriRuntime, e.isTrusted)) {
          overlaySynthetic.reset();
      }

      setLinkingState(prev => ({ ...prev, isLinking: false }));
  };

  const handleGlobalMouseDown = (e: MouseEvent) => {
      // Background Click -> Start Selection or Clear Selection
      // ... (logic remains)

      // PRIORITY: Capture/Selection Mode
      if (isSelecting()) {
          if (isTauriRuntimeAvailable()) {
              return;
          }
          handleSelectionStart(e);
          return;
      }

      // Check if target is not a unit/interactive
      if (shouldStartCanvasSelectionFromTarget(e.target)) {

           // Clear Selection if not holding Shift/Ctrl?
           if (!e.shiftKey && !e.ctrlKey) {
               setSelectedStickerId(null);
               resetSelection();
               uiActions.hideStickerToolbar();
           }

            if (!checkDragModifier(e, 'dragOut')) {
                 handleSelectionStart(e);
            }
      }
  };

  // Unit Interaction wrappers
  // Unit Interaction wrappers
  const onStartDragUnit = (e: MouseEvent, id: string) => {
      // FIX: Allow native file drag if Shift is held (Drag-Out Mode)
      if (checkDragModifier(e, 'dragOut')) {
           return; // Allow native behavior (no preventDefault)
      }

      e.stopPropagation(); // Stop propagation to canvas
      e.preventDefault();  // Stop text selection

      if (isSelecting()) {
          // If in Capture Mode, we might want to allow selection start?
          // Existing logic: "If isSelecting, handleSelectionStart(e)".
          // Yet here we return?
          // If we return here, the click propagates to `handleGlobalMouseDown`?
          // We called `e.stopPropagation()` above! So it WON'T propagate.
          // So if isSelecting(), and we click a unit, NOTHING happens?
          // We should probably allow the Capture Box to start if we click "over" a unit?
          // Or we treat units as transparent to Capture?
          // Let's assume hitting a unit acts as hitting background if isSelecting.
          // So we should NOT stopPropagation?
          // But preventing default is good.
          // Let's manually trigger selection start?
           handleSelectionStart(e);
           return;
      }

      // Multi-Select Interaction Logic
      const wasSelected = selectedUnitIds.includes(id);
      const targetUnit = graphStore.units.find((unit) => unit.id === id);
      const targetGroup = targetUnit?.data.groupId
          ? graphStore.stickerGroups.find((group) => group.id === targetUnit.data.groupId)
          : undefined;
      const activeEditTarget = activeStickerEditTargetId();
      if (activeEditTarget && activeEditTarget !== id) {
          uiActions.hideStickerToolbar();
      }
      if (targetGroup?.locked) {
          return;
      }

      void api.focusOverlayWindow();

      batch(() => {
          if (e.ctrlKey) {
               // Toggle Logic
               if (wasSelected) {
                   // If already selected, we DON'T toggle off immediately on MouseDown.
                   // We wait to see if it's a Drag or a Click.
                   // This is handled by the onClick callback passed to startDrag below.
               } else {
                   selectionActions.add(id);
               }
          } else {
               // No Modifiers
               if (!wasSelected) {
                   // Clicked unselected -> Exclusive Select
                   selectionActions.set([id]);
               }
               // else: Clicked part of group -> Keep group (for potential drag)
          }

          startDrag(e, id, (clickedId) => {
              const clickedUnit = graphStore.units.find((unit) => unit.id === clickedId);
              if (clickedUnit?.type !== "sticker" || activeStickerEditTargetId() !== clickedId) {
                  uiActions.hideStickerToolbar();
              }
              // Handle Click (No Drag)
              if (e.ctrlKey) {
                  // Only toggle off if it WAS selected *before* this interaction
                  if (wasSelected) {
                      selectionActions.toggle(clickedId);
                  }
              } else {
                  // Click without Ctrl on a group member -> Exclusive Select (Deselect others)
                  selectionActions.set([clickedId]);
              }
          });
      });
  };



  // Canvas display-image resolution lives in graphImageResolution.ts
  // (resolveCanvasDisplayImage), characterized by resolveCanvasDisplayImage.test.ts.
  const resolveUnitImage = (id: string): string | undefined =>
      resolveCanvasDisplayImage({ units: graphStore.units, links: graphStore.links, unitId: id });

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
                    "hook-last-error",
                    `[${new Date().toISOString()}] render-error\n${detail}`,
                );
            } catch {
                /* ignore */
            }
            if (isTauriRuntimeAvailable()) {
                void api.debugLogEvent("render-error", detail);
            }
            return (
                <div class="hook-render-error">
                    {"render-error (click 重试 to recover)\n\n" + detail}
                    <div class="hook-render-error__actions">
                        <button
                            type="button"
                            class="hook-render-error__retry"
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

        <div id="ports-layer" ref={portsLayerRef!} class="absolute inset-0 z-[5] pointer-events-none overflow-visible" />

        <CanvasUnits
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
            portsLayerRef={portsLayerRef}
        />

        {/* Layer 3: Selection Overlay */}
        <CanvasSelection />

        <Show when={longCaptureSession()}>
            {(session) => (
                <div class="hook-terminal-shell hook-terminal-shell--strong hook-capture-status-shell absolute right-5 top-5 z-[2147483646] px-4 py-3 text-xs pointer-events-none">
                    <div class="hook-capture-status-title mb-1 text-sm font-semibold">长截图录制中</div>
                    <div>已保留 {session().frameCount} 帧</div>
                    <div>已忽略 {session().duplicateCount ?? 0} 张重复画面</div>
                    <div>方向 {session().axis ?? "自动检测"}</div>
                    <div class="hook-capture-status-copy mt-1">{session().lastMessage ?? "请慢速向下滚动，Hook 会录制非重复画面，完成后统一拼接"}</div>
                    <div class="hook-capture-status-shortcut mt-2">Enter/Ctrl+3 完成，Esc 取消</div>
                </div>
            )}
        </Show>

        <div hidden aria-hidden="true" data-testid="hook-tea-automation-surface">
            <button
                type="button"
                data-testid="tea-ticket-button"
                onClick={() => void createTeaTicketFromCurrentHookState("automation")}
            />
            <output data-testid="tea-ticket-output">
                {lastTeaTicket()?.id || lastTeaTicketError() || ""}
            </output>
        </div>

        <StickerContextMenuLayer />

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
