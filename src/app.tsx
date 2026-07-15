import { onMount, onCleanup, createEffect, createSignal, Show, ErrorBoundary } from "solid-js";
import { api, isTauriRuntimeAvailable, listenBrowserArtLoomMethod, type TeaTicketSummary, type VoiceSettingsSummary } from "./services/api";
import { listen } from "@tauri-apps/api/event";
import { installErrorDiagnostics } from "./services/errorDiagnostics";
import { logger } from "./services/logger";

import "./app.css";

// Components
import { CanvasLinks } from "./components/CanvasLinks";
import { CanvasUnits } from "./components/CanvasUnits";
import { CanvasSelection } from "./components/CanvasSelection";
import { StickerGroupBar } from "./components/StickerGroupBar";
import { HistoryPanel } from "./components/HistoryPanel";
import { StickerContextMenuLayer } from "./components/StickerContextMenuLayer";
import { sanitizeHistoryState } from "./services/historyModel";
import { normalizeStickerToolSettings } from "./services/toolSettings";
import { addRecycleBinEntry } from "./services/stickerLibraryModel";
import { captureFrozenStickerSnapshot } from "./services/stickerSnapshot";

// Stores & Services
import { graphStore } from "./store/graphStore";
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
    longCaptureSession,
    setInstalledStickerFonts,
    draggingStickerId,
} from "./store/uiStore";


import { artLoom } from "./services/client";
import { syncService } from "./services/syncService";
import { shaderCache } from "./services/shaderCache";
import type { BootProfile } from "./services/bootProfile";
import { captureStickerEditSnapshot } from "./services/stickerHistory";
import { removeAnnotationById } from "./services/stickerAnnotationMutations";
import { stickerContextMenuController } from "./services/stickerContextMenuController";
import {
    beginCaptureSelectionState,
    resolveShortcutContext,
    shouldStartCanvasSelectionFromTarget,
    type CaptureSelectionMode,
} from "./services/captureState";
import {
    normalizeWorkflowSnapshotPayload,
    type WorkflowSnapshotPayload,
} from "./services/workflowPayload";
import { buildUnitPortsFromCapability } from "./services/artNodeFactory";
import { deriveUnitExecutionConfig } from "./services/nodeExecutionConfig";
import { refreshArtLoomCapabilitiesOnStartup } from "./services/artLoomStartup";

// Hooks
import { useDraggable } from "./hooks/useDraggable";
import { useSelection } from "./hooks/useSelection";
import { useShortcuts, checkDragModifier } from "./hooks/useShortcuts";
import { useLinking } from "./hooks/useLinking";
import { useUnitActions } from "./hooks/useUnitActions";
import { useClipboard } from "./hooks/useClipboard";
import { useFileDrop } from "./hooks/useFileDrop";
import type { ArtDelivery, ArtCapability } from "./services/protocol";
import type { Unit, Link } from "./types/unit";

type VoiceStatus = "idle" | "recording" | "transcribing" | "completed" | "failed" | "cancelled" | "unknown";

type VoiceHotkeyPayload = {
    shortcut: string;
    event: unknown;
    kind: string;
    statusHint: string;
};

type VoiceSessionPayload = {
    id: string;
    status: string;
    transcript?: string | null;
    outputText?: string | null;
    error?: string | null;
    sessionLogPath?: string | null;
};

type OverlaySyntheticMousePayload = {
    x?: number;
    y?: number;
    globalX?: number;
    globalY?: number;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    deltaY?: number;
    nativeDragPreflight?: boolean;
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

export default function App() {
  let portsLayerRef: HTMLDivElement | undefined;
  let activeBootProfile: BootProfile | null = null;
  const tauriRuntime = isTauriRuntimeAvailable();
  const [, setVoiceStatus] = createSignal<VoiceStatus>("idle");
  const [, setLastVoiceHotkey] = createSignal<VoiceHotkeyPayload | null>(null);
  const [lastVoiceSession, setLastVoiceSession] = createSignal<VoiceSessionPayload | null>(null);
  const [, setVoiceSettings] = createSignal<VoiceSettingsSummary | null>(null);
  const [lastTeaTicket, setLastTeaTicket] = createSignal<TeaTicketSummary | null>(null);
  const [lastTeaTicketError, setLastTeaTicketError] = createSignal<string | null>(null);

  // Hooks Integration
  const { startDrag, handleDragMove, handleDragEnd } = useDraggable();
  const {
      handleSelectionStart,
      handleSelectionMove,
      handleSelectionEnd,
      resetSelection,
      finishAutoLongCaptureSession,
      cancelAutoLongCaptureSession,
      notifyAutoLongCaptureWheel,
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

  const STICKER_GLOBAL_DELETE_ARM_WINDOW_MS = 2500;
  const OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE = 4;
  const OVERLAY_SYNTHETIC_DOUBLE_CLICK_MAX_DELAY_MS = 320;
  let lastStickerKeyboardDeleteArmAt = 0;
  let overlaySyntheticPointerTarget: EventTarget | null = null;
  let overlaySyntheticPointerDownTarget: EventTarget | null = null;
  let overlaySyntheticHoverTarget: EventTarget | null = null;
  let overlaySyntheticPointerDownPoint: { x: number; y: number } | null = null;
  let overlaySyntheticLastClickTarget: EventTarget | null = null;
  let overlaySyntheticLastClickPoint: { x: number; y: number } | null = null;
  let overlaySyntheticLastClickAt = 0;
  let overlaySyntheticPointerActive = false;
  let overlaySyntheticPrimaryButtonDown = false;
  let overlaySyntheticMoveRelayActive = false;
  const armStickerKeyboardDelete = () => {
      lastStickerKeyboardDeleteArmAt = Date.now();
  };
  const resetOverlaySyntheticPointerState = () => {
      overlaySyntheticPointerTarget = null;
      overlaySyntheticPointerActive = false;
      overlaySyntheticPrimaryButtonDown = false;
      overlaySyntheticMoveRelayActive = false;
  };
  const dispatchSyntheticOverlayMouseEvent = (
      type: "mousedown" | "mousemove" | "mouseup" | "wheel" | "contextmenu",
      payload: OverlaySyntheticMousePayload,
  ) => {
      if (typeof document === "undefined") return;

      const clientX = payload.x ?? payload.globalX ?? 0;
      const clientY = payload.y ?? payload.globalY ?? 0;
      const appMain = document.getElementById("app-main");
      const resolveEditableSyntheticControl = (target: EventTarget | null) => {
          if (!(target instanceof Element)) return null;
          if (
              target instanceof HTMLInputElement ||
              target instanceof HTMLSelectElement ||
              target instanceof HTMLTextAreaElement
          ) {
              return target;
          }
          return target.closest("input, select, textarea");
      };
      const focusEditableSyntheticControl = (target: EventTarget | null) => {
          const editable = resolveEditableSyntheticControl(target);
          if (!editable || !(editable instanceof HTMLElement)) return;
          editable.focus();
      };
      const isOverlayRootTarget = (target: EventTarget | null) =>
          target === appMain ||
          target === document.body ||
          target === document.documentElement ||
          target === window;
      const isStickerInteractionRootTarget = (target: EventTarget | null) =>
          target instanceof Element &&
          target.getAttribute("data-sticker-interaction-root") === "true";
      const resolveTarget = (allowFallback: boolean) => {
          const rawTarget = document.elementFromPoint(clientX, clientY) as EventTarget | null;
          if (!rawTarget || isOverlayRootTarget(rawTarget)) {
              return allowFallback ? appMain ?? window : null;
          }
          if (rawTarget instanceof Element) {
              const stickerInteractionRoot =
                  rawTarget.closest?.("[data-sticker-interaction-root='true']") ?? null;
              if (stickerInteractionRoot) {
                  return stickerInteractionRoot;
              }
          }
          return rawTarget;
      };
      const buildBaseInit = (button: number, buttons: number) => ({
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX,
          clientY,
          screenX: payload.globalX ?? clientX,
          screenY: payload.globalY ?? clientY,
          ctrlKey: !!payload.ctrlKey,
          altKey: !!payload.altKey,
          shiftKey: !!payload.shiftKey,
          button,
          buttons,
      });
      const dispatchHoverTransition = (
          nextTarget: EventTarget | null,
          pointerInit: PointerEventInit,
          mouseInit: MouseEventInit,
      ) => {
          const previousTarget = overlaySyntheticHoverTarget;
          if (previousTarget === nextTarget) {
              return;
          }

          if (previousTarget) {
              if (typeof PointerEvent !== "undefined") {
                  previousTarget.dispatchEvent(
                      new PointerEvent("pointerout", {
                          ...pointerInit,
                          relatedTarget: nextTarget,
                      }),
                  );
                  previousTarget.dispatchEvent(
                      new PointerEvent("pointerleave", {
                          ...pointerInit,
                          bubbles: false,
                          relatedTarget: nextTarget,
                      }),
                  );
              }
              previousTarget.dispatchEvent(
                  new MouseEvent("mouseout", {
                      ...mouseInit,
                      relatedTarget: nextTarget,
                  }),
              );
              previousTarget.dispatchEvent(
                  new MouseEvent("mouseleave", {
                      ...mouseInit,
                      bubbles: false,
                      relatedTarget: nextTarget,
                  }),
              );
          }

          if (nextTarget) {
              if (typeof PointerEvent !== "undefined") {
                  nextTarget.dispatchEvent(
                      new PointerEvent("pointerover", {
                          ...pointerInit,
                          relatedTarget: previousTarget,
                      }),
                  );
                  nextTarget.dispatchEvent(
                      new PointerEvent("pointerenter", {
                          ...pointerInit,
                          bubbles: false,
                          relatedTarget: previousTarget,
                      }),
                  );
              }
              nextTarget.dispatchEvent(
                  new MouseEvent("mouseover", {
                      ...mouseInit,
                      relatedTarget: previousTarget,
                  }),
              );
              nextTarget.dispatchEvent(
                  new MouseEvent("mouseenter", {
                      ...mouseInit,
                      bubbles: false,
                      relatedTarget: previousTarget,
                  }),
              );
          }

          overlaySyntheticHoverTarget = nextTarget;
      };

      const baseInit =
          type === "contextmenu"
              ? buildBaseInit(2, 0)
              : buildBaseInit(
                    0,
                    type === "mouseup"
                        ? 0
                        : overlaySyntheticPrimaryButtonDown || type === "mousedown"
                          ? 1
                          : 0,
                );
      const pointerInit: PointerEventInit = {
          ...baseInit,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
      };
      const shouldResolveLiveOverlayTarget =
          linkingState().isLinking && (type === "mousemove" || type === "mouseup");

      let target: EventTarget | null =
          type === "mousemove" && !overlaySyntheticPrimaryButtonDown
              ? resolveTarget(false)
              : resolveTarget(true);
      const shouldBypassSyntheticPointerCapture =
          type === "mousedown" &&
          !!payload.shiftKey &&
          isStickerInteractionRootTarget(target);
      if (type === "mousedown") {
          if (shouldBypassSyntheticPointerCapture) {
              overlaySyntheticPointerDownTarget = null;
              overlaySyntheticPointerDownPoint = null;
              resetOverlaySyntheticPointerState();
          } else {
              resetOverlaySyntheticPointerState();
              overlaySyntheticPointerTarget = target;
              overlaySyntheticPointerDownTarget = target;
              overlaySyntheticPointerDownPoint = { x: clientX, y: clientY };
              overlaySyntheticPointerActive = true;
              overlaySyntheticPrimaryButtonDown = true;
          }
      } else if (shouldResolveLiveOverlayTarget) {
          target = resolveTarget(true);
      } else if (
          (type === "mousemove" || type === "mouseup") &&
          overlaySyntheticPointerActive &&
          overlaySyntheticPointerTarget
      ) {
          target = overlaySyntheticPointerTarget;
      }
      if (type === "mousemove" && overlaySyntheticPrimaryButtonDown && draggingStickerId()) {
          target = appMain ?? window;
      }

      if (!target) {
          dispatchHoverTransition(null, pointerInit, baseInit);
          return;
      }

      if (
          type === "mousedown" ||
          (type === "mousemove" && !overlaySyntheticPrimaryButtonDown) ||
          type === "contextmenu"
      ) {
          dispatchHoverTransition(target, pointerInit, baseInit);
      }
      if (type === "mousedown") {
          focusEditableSyntheticControl(target);
      }

      if (type !== "wheel" && type !== "contextmenu" && typeof PointerEvent !== "undefined") {
          target.dispatchEvent(
              new PointerEvent(
                  type === "mouseup"
                      ? "pointerup"
                      : type === "mousemove"
                        ? "pointermove"
                        : "pointerdown",
                  pointerInit,
              ),
          );
      }

      if (type === "wheel") {
          target.dispatchEvent(
              new WheelEvent("wheel", {
                  ...baseInit,
                  deltaY: payload.deltaY ?? 0,
              }),
          );
      } else if (type === "contextmenu") {
          target.dispatchEvent(new MouseEvent("contextmenu", baseInit));
      } else {
          target.dispatchEvent(new MouseEvent(type, baseInit));
      }

      if (type === "mouseup") {
          if (
              overlaySyntheticPointerDownTarget &&
              overlaySyntheticPointerDownTarget === target &&
              overlaySyntheticPointerDownPoint &&
              Math.hypot(
                  clientX - overlaySyntheticPointerDownPoint.x,
                  clientY - overlaySyntheticPointerDownPoint.y,
              ) <= OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE
          ) {
              focusEditableSyntheticControl(target);
              target.dispatchEvent(new MouseEvent("click", buildBaseInit(0, 0)));
              const clickTime = Date.now();
              const isDoubleClick =
                  overlaySyntheticLastClickTarget === target &&
                  overlaySyntheticLastClickPoint &&
                  clickTime - overlaySyntheticLastClickAt <= OVERLAY_SYNTHETIC_DOUBLE_CLICK_MAX_DELAY_MS &&
                  Math.hypot(
                      clientX - overlaySyntheticLastClickPoint.x,
                      clientY - overlaySyntheticLastClickPoint.y,
                  ) <= OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE;
              if (isDoubleClick) {
                  target.dispatchEvent(new MouseEvent("dblclick", buildBaseInit(0, 0)));
                  overlaySyntheticLastClickTarget = null;
                  overlaySyntheticLastClickPoint = null;
                  overlaySyntheticLastClickAt = 0;
              } else {
                  overlaySyntheticLastClickTarget = target;
                  overlaySyntheticLastClickPoint = { x: clientX, y: clientY };
                  overlaySyntheticLastClickAt = clickTime;
              }
          }
          overlaySyntheticPointerDownTarget = null;
          overlaySyntheticPointerDownPoint = null;
          resetOverlaySyntheticPointerState();
      }
  };
  const relayOverlaySyntheticPointerMove = (event: MouseEvent) => {
      if (
          !overlaySyntheticPointerActive ||
          !overlaySyntheticPrimaryButtonDown ||
          !overlaySyntheticPointerTarget ||
          event.target === overlaySyntheticPointerTarget
      ) {
          return;
      }

      const baseInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          button: 0,
          buttons: event.buttons,
      };

      overlaySyntheticMoveRelayActive = true;
      try {
          if (typeof PointerEvent !== "undefined") {
              overlaySyntheticPointerTarget.dispatchEvent(
                  new PointerEvent("pointermove", {
                      ...baseInit,
                      pointerId: 1,
                      pointerType: "mouse",
                      isPrimary: true,
                  }),
              );
          }
          overlaySyntheticPointerTarget.dispatchEvent(new MouseEvent("mousemove", baseInit));
      } finally {
          overlaySyntheticMoveRelayActive = false;
      }
  };

  const isContextualShaderArt = (art: ArtCapability) =>
      art.execution_type === "shader" &&
      ((art.params || []).some((param) => param.widget === "image_link" || param.id === "reference") ||
          (art.inputs || []).some((input) => input.name === "reference"));

  const getCapabilityArtPath = (art: ArtCapability) => {
      const artPath = art.execution?.artPath;
      return typeof artPath === "string" && artPath.length > 0 ? artPath : undefined;
  };

  const toggleStickerToolbarVisibility = () => {
      const stickerId = selectedStickerId();
      if (tauriRuntime) {
          void api.debugLogEvent(
              "toggle-sticker-toolbar",
              `selected=${stickerId ?? "null"} active=${activeStickerEditTargetId() ?? "null"}`,
          );
      }
      if (!stickerId) return;
      const selectedUnit = graphStore.units.find((unit) => unit.id === stickerId);
      if (selectedUnit?.type !== "sticker") return;

      if (activeStickerEditTargetId() === stickerId) {
          uiActions.hideStickerToolbar();
          return;
      }

      uiActions.showStickerToolbar(stickerId);
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

  const applyStickerHistorySnapshot = async (direction: "undo" | "redo") => {
      const id = selectedStickerId();
      if (!id) return;
      const unit = graphStore.units.find((item) => item.id === id);
      if (!unit || unit.type !== "sticker") return;

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
      if (ids.length === 0) return "";

      const idSet = new Set(ids);
      return graphStore.units
          .filter((unit) => idSet.has(unit.id))
          .map((unit) => [
              `id=${unit.id}`,
              `type=${unit.type}`,
              `art=${unit.artId || "none"}`,
              `originWorkflow=${unit.data?.originWorkflowId || "none"}`,
              `originNode=${unit.data?.originNodeId || "none"}`,
          ].join(" "))
          .join("\n");
  };

  const buildTeaTicketText = (trigger: string) => {
      const selectedSummary = summarizeSelectedUnitsForTea();
      const voiceOutput = lastVoiceSession()?.outputText || lastVoiceSession()?.transcript || "";
      return [
          `Hook desktop ticket request (${trigger})`,
          `units: ${graphStore.units.length}`,
          `links: ${graphStore.links.length}`,
          selectedSummary ? `selected_units:\n${selectedSummary}` : "selected_units: none",
          voiceOutput ? `voice_context:\n${voiceOutput}` : "voice_context: none",
          "requested_action: Analyze this Hook context and propose the next AI work-order plan.",
      ].join("\n");
  };

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

  const refreshCapabilities = async () => {
      const handshake = await artLoom.connect();
      const arts = handshake.capabilities?.art_definitions || [];
      graphStore.setCapabilities(arts);

      const shaderArts = arts.filter((art: ArtCapability) => art.execution_type === "shader");
      shaderArts
          .filter((art) => !isContextualShaderArt(art))
          .forEach((art: ArtCapability) => {
          void shaderCache.prefetchShader(art.id, getCapabilityArtPath(art));
      });
  };

  const loadInstalledFontsInBackground = () => {
      void api
          .getInstalledFonts()
          .then((fonts) => {
              setInstalledStickerFonts(fonts);
          })
          .catch((error) => {
              console.warn("Failed to load installed fonts:", error);
          });
  };

  const buildPortsFromCapability = (type: "sticker" | "art", artId?: string) => {
      const capability = graphStore.capabilities.find((item) => item.id === artId);
      return buildUnitPortsFromCapability(type, capability);
  };

  const instantiateWorkflowSnapshot = async (payload: WorkflowSnapshotPayload) => {
      const incomingNodes = payload.nodes;
      const incomingEdges = payload.edges;
      if (incomingNodes.length === 0) return;

      const isReferenceMode = payload.mode === "reference" && !!payload.workflow_id;
      const incomingOriginNodeIds = new Set(
          incomingNodes
              .map((node) => (typeof node.id === "string" ? node.id : undefined))
              .filter((nodeId): nodeId is string => !!nodeId)
      );
      const existingReferenceUnitsByOrigin = new Map<string, Unit>();
      if (isReferenceMode) {
          graphStore.units.forEach((unit) => {
              const originWorkflowId = unit.data?.originWorkflowId;
              const originNodeId = unit.data?.originNodeId;
              if (
                  originWorkflowId === payload.workflow_id &&
                  originNodeId &&
                  incomingOriginNodeIds.has(originNodeId)
              ) {
                  existingReferenceUnitsByOrigin.set(originNodeId, unit);
              }
          });
      }

      const idMap = new Map<string, string>();
      incomingNodes.forEach((node) => {
          const existingUnit =
              isReferenceMode && typeof node.id === "string"
                  ? existingReferenceUnitsByOrigin.get(node.id)
                  : undefined;
          idMap.set(node.id, existingUnit?.id || crypto.randomUUID());
      });

      const instantiatedUnits: Unit[] = incomingNodes.map((node) => {
          const localId = idMap.get(node.id)!;
          const nodeType: "sticker" | "art" = node.type === "sticker" ? "sticker" : "art";
          const artId = node.data?.artId || node.data?.art_id || undefined;
          const capability = graphStore.capabilities.find((item) => item.id === artId);
          const { inputs, outputs } = buildPortsFromCapability(nodeType, artId);
          const executionConfig = deriveUnitExecutionConfig({
              capability,
              explicitConfig: node.data?.executionConfig,
          });

          return {
              id: localId,
              type: nodeType,
              artId,
              x: node.position?.x ?? 0,
              y: node.position?.y ?? 0,
              w: node.data?.w ?? node.measured?.width ?? 240,
              h: node.data?.h ?? node.measured?.height ?? 180,
              params: node.data?.params || {},
              inputs,
              outputs,
              data: {
                  src: node.data?.src,
                  previewSrc: node.data?.previewSrc,
                  rasterizedAnnotationLayerSrc: node.data?.rasterizedAnnotationLayerSrc,
                  minified: node.data?.minified ?? false,
                  savedRect: node.data?.savedRect,
                  cropOffset: node.data?.cropOffset,
                  opacityNormal: node.data?.opacityNormal ?? 1,
                  opacityMini: node.data?.opacityMini ?? 0.9,
                  executionConfig,
                  originWorkflowId: isReferenceMode ? payload.workflow_id || undefined : undefined,
                  originNodeId: isReferenceMode ? node.id : undefined,
              },
          };
      });

      const instantiatedLinks: Link[] = incomingEdges
          .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
          .map((edge) => ({
              id: crypto.randomUUID(),
              fromUnitId: idMap.get(edge.source)!,
              fromPortId: edge.sourceHandle || "output",
              toUnitId: idMap.get(edge.target)!,
              toPortId: edge.targetHandle || "input",
          }));

      const referencedLocalIds = new Set(instantiatedUnits.map((unit) => unit.id));
      const linkKey = (link: Link) =>
          `${link.fromUnitId}::${link.fromPortId || ""}::${link.toUnitId}::${link.toPortId || ""}`;

      graphStore.setUnits((prev) => {
          const nextById = new Map(prev.map((unit) => [unit.id, unit] as const));
          instantiatedUnits.forEach((unit) => {
              nextById.set(unit.id, unit);
          });
          return Array.from(nextById.values());
      });
      graphStore.setLinks((prev) => {
          const next = prev.filter(
              (link) => !(referencedLocalIds.has(link.fromUnitId) && referencedLocalIds.has(link.toUnitId))
          );
          const seen = new Set(next.map(linkKey));
          instantiatedLinks.forEach((link) => {
              const key = linkKey(link);
              if (!seen.has(key)) {
                  seen.add(key);
                  next.push(link);
              }
          });
          return next;
      });
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
      const unit = graphStore.units.find((item) => item.id === unitId);
      if (!unit) return;

      if (delivery.status !== 200) {
          graphStore.actions.updateUnitData(unitId, {
              processing: false,
              nodeStatus: "error",
              errorMessage: delivery.error || "Art execution failed",
          });
          await syncService.performWorkflowSync();
          return;
      }

      let previewSrc: string | undefined;
      let filePath: string | undefined;
      let resultHandle: string | undefined;
      let outputValues: Record<string, unknown> | undefined;

      switch (delivery.delivery.type) {
          case "shared_memory":
          case "shm":
              if (delivery.delivery.handle && delivery.delivery.size && delivery.delivery.width && delivery.delivery.height) {
                  previewSrc = await api.readSharedMemory(
                      delivery.delivery.handle,
                      delivery.delivery.size,
                      delivery.delivery.width,
                      delivery.delivery.height
                  );
                  resultHandle = delivery.delivery.handle;
              }
              break;
          case "base64":
              previewSrc = delivery.delivery.data;
              break;
          case "file_path":
              filePath = delivery.delivery.path;
              if (filePath) {
                  previewSrc = await api.readImageFromPath(filePath);
              }
              break;
          case "shader":
              graphStore.actions.updateUnitData(unitId, {
                  processing: false,
                  nodeStatus: "completed",
                  progress: 1,
                  errorMessage: undefined,
              });
              await syncService.performWorkflowSync();
              return;
          case "value":
          case "json":
          case "text":
          case "number":
              outputValues = {
                  output: delivery.delivery.value ?? delivery.delivery.data,
                  ...(delivery.delivery.outputs || {}),
              };
              break;
          default:
              break;
      }

      const nextOutputs: Record<string, unknown> = {
          ...(unit.data.outputs || {}),
          ...(outputValues || {}),
      };
      if (previewSrc) {
          nextOutputs.output = previewSrc;
          nextOutputs.output_image = previewSrc;
      }
      if (filePath) {
          nextOutputs.file_path = filePath;
      }

      graphStore.actions.updateUnitData(unitId, {
          previewSrc: previewSrc || unit.data.previewSrc,
          filePath,
          resultHandle,
          outputs: nextOutputs,
          processing: false,
          progress: 1,
          nodeStatus: "completed",
          errorMessage: undefined,
      });
      propagateFromUnit(unitId);
      await syncService.performWorkflowSync();
  };

  const deleteSelectedUnitOrAnnotation = () => {
      const annotationId = selectedStickerAnnotationId();
      const stickerId = selectedStickerId();
      if (annotationId && stickerId) {
          const activeUnit = graphStore.units.find((unit) => unit.id === stickerId);
          if (activeUnit?.type === "sticker" && activeUnit.data.annotationState) {
              uiActions.pushStickerHistory(stickerId, captureStickerEditSnapshot(activeUnit));
              graphStore.actions.updateStickerEditData(stickerId, {
                  annotationState: removeAnnotationById(activeUnit.data.annotationState, annotationId),
              });
              graphStore.actions.propagateStickerEditsFrom(stickerId);
              uiActions.setSelectedStickerAnnotation(null);
              void syncService.performWorkflowSync();
              return;
          }
      }

      const selectedSticker = selectedStickerId();
      const ids = selectedUnitIds.length > 0
          ? [...selectedUnitIds]
          : selectedSticker
              ? [selectedSticker]
              : [];

      if (ids.length > 0) {
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
              isSelecting: isSelecting(),
              hasSelectedSticker: Boolean(selectedStickerId()),
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
          onCancelSelection: async () => {
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
          onToggleStickerToolbar: tauriRuntime ? undefined : () => {
              toggleStickerToolbarVisibility();
          },
          onToggleActions: () => {
              const id = selectedStickerId();
              if (id) {
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

      resetOverlaySyntheticPointerState();
      resetSelection();
      setCaptureMode(captureStart.captureMode);
      setIsSelecting(true);
      try {
          const cursor = await api.getCursorPosition();
          setMousePos({ x: cursor.x, y: cursor.y });
      } catch {
          // Best-effort only; backend global mouse_move will refresh this immediately.
      }
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
                  `startupMode=${bootProfile.startupMode} initialUiMode=${bootProfile.initialUiMode} autoStartCapture=${bootProfile.autoStartCapture} artLoomEnabled=${bootProfile.artLoomEnabled}`,
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
              void beginCaptureSelection("region");
          });

          const unlistenLongCapture = await listen("trigger-long-capture", () => {
              logger.debug("Backend Triggered Long Capture Mode");
              void api.debugLogEvent("trigger-long-capture-listener");
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

           const unlistenCreateTeaTicket = await listen("trigger-create-tea-ticket", () => {
               logger.debug("Backend Triggered Tea Ticket Creation");
               void api.debugLogEvent("trigger-create-tea-ticket-listener");
               void createTeaTicketFromCurrentHookState("tray");
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

          const unlistenEscape = await listen("trigger-escape", () => {
              void api.debugLogEvent("trigger-escape-listener");
              if (longCaptureSession()?.active) {
                  void cancelAutoLongCaptureSession();
                  return;
              }
              if (isSelecting()) {
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
              if (selectedStickerId()) {
                  deleteSelectedUnitOrAnnotation();
              }
          });

          const unlistenDelete = await listen("trigger-delete", () => {
              void api.debugLogEvent("trigger-delete-listener");
              if (longCaptureSession()?.active || isSelecting()) {
                  return;
              }
              if (!selectedStickerId()) {
                  return;
              }
              const elapsedMs = Date.now() - lastStickerKeyboardDeleteArmAt;
              if (elapsedMs > STICKER_GLOBAL_DELETE_ARM_WINDOW_MS) {
                  void api.debugLogEvent("trigger-delete-ignored-stale", `elapsedMs=${elapsedMs}`);
                  return;
              }
              deleteSelectedUnitOrAnnotation();
          });

          // Create a minimal MouseEvent-compatible object for capture events
          const toCaptureMouseEvent = (payload: { x?: number; y?: number }): Pick<MouseEvent, "clientX" | "clientY" | "shiftKey" | "ctrlKey" | "target"> => ({
              clientX: payload?.x ?? 0,
              clientY: payload?.y ?? 0,
              shiftKey: false,
              ctrlKey: false,
              target: document.getElementById("app-main") as HTMLElement,
          });

          const unlistenCaptureDown = await listen<{ x?: number; y?: number }>(
              "capture/global_mouse_down",
              (event) => {
                  if (!isSelecting()) return;
                  const captureEvent = toCaptureMouseEvent(event.payload);
                  setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });
                  handleSelectionStart(captureEvent);
              },
          );

          const unlistenCaptureMove = await listen<{ x?: number; y?: number }>(
              "capture/global_mouse_move",
              (event) => {
                  if (!isSelecting()) return;
                  const captureEvent = toCaptureMouseEvent(event.payload);
                  setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });
                  handleSelectionMove(captureEvent);
              },
          );

          const unlistenCaptureUp = await listen<{ x?: number; y?: number }>("capture/global_mouse_up", (event) => {
              if (!isSelecting()) return;
              const captureEvent = toCaptureMouseEvent(event.payload);
              setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });
              handleSelectionMove(captureEvent);
              handleSelectionEnd(captureEvent);
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
                      dispatchSyntheticOverlayMouseEvent("mousedown", event.payload);
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
                  } else {
                      dispatchSyntheticOverlayMouseEvent("mousemove", event.payload);
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
                      dispatchSyntheticOverlayMouseEvent("mouseup", event.payload);
                  }
              },
          );

          const unlistenOverlayMouseWheel = await listen<OverlaySyntheticMousePayload>(
              "overlay/global_mouse_wheel",
              (event) => {
                  dispatchSyntheticOverlayMouseEvent("wheel", event.payload);
              },
          );

          const unlistenOverlayContextMenu = await listen<OverlaySyntheticMousePayload>(
              "overlay/global_context_menu",
              (event) => {
                  dispatchSyntheticOverlayMouseEvent("contextmenu", event.payload);
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

          const unlistenConnectionState = await listen<{ connected?: boolean }>(
              "art/loom_connection_state",
              async (event) => {
                  if (event.payload?.connected) {
                      logger.debug("ArtLoom desktop bridge connected, refreshing capabilities");
                      try {
                          await refreshCapabilities();
                      } catch (e) {
                          console.error("Failed to refresh capabilities after reconnect", e);
                      }
                  } else {
                      console.warn("ArtLoom desktop bridge disconnected");
                  }
              },
          );

          const unlistenProgress = await artLoom.listenForProgress((artId, progress) => {
              graphStore.actions.updateUnitData(artId, {
                  processing: true,
                  nodeStatus: "running",
                  progress,
              });
          });

          const unlistenDelivery = await artLoom.listenForDelivery((delivery) => {
              handleArtDelivery(delivery).catch((error) => {
                  console.error("Failed to process art delivery", error);
                  graphStore.actions.updateUnitData(delivery.art_id, {
                      processing: false,
                      nodeStatus: "error",
                  });
              });
          });

          cleanups.push(
              unlistenOcr,
              unlistenCapture,
              unlistenLongCapture,
              unlistenLongCaptureFinish,
              unlistenLongCaptureWheel,
              unlistenStickerToolbar,
              unlistenOpenImage,
              unlistenCopy,
              unlistenPaste,
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
              unlistenConnectionState,
              unlistenProgress,
              unlistenDelivery,
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
          await refreshArtLoomCapabilitiesOnStartup(
              bootProfile?.artLoomEnabled ?? false,
              refreshCapabilities,
          );
      } catch (e) {
          console.warn("ArtLoom bridge unavailable during startup; continuing in standalone mode.", e);
      }

      await syncService.restoreSession(bootProfile || undefined);

      // Load persisted color/screenshot history (best-effort; never blocks boot).
      try {
          const rawHistory = await api.loadHistory();
          uiActions.setHistoryState(sanitizeHistoryState(rawHistory));
      } catch (error) {
          console.warn("Failed to load history; starting with empty history.", error);
      }

      loadInstalledFontsInBackground();

      if (bootProfile?.autoStartCapture) {
          await api.debugLogEvent("boot-autostart-capture");
          await api.triggerCaptureMode();
      }

      if (!tauriRuntimeAvailable) {
          logger.debug("Running in browser preview mode; attaching browser IPC listeners.");
          const stopInstantiate = listenBrowserArtLoomMethod("art_hook/instantiate", (payload) => {
              instantiateWorkflowSnapshot(normalizeWorkflowSnapshotPayload(payload)).catch((error) => {
                  console.error("Browser instantiate handler failed:", error);
              });
          });
          const stopCapabilitiesUpdated = listenBrowserArtLoomMethod("art_loom/arts_updated", async () => {
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

      onCleanup(() => {
          cleanups.forEach((fn) => fn());
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
  const handleGlobalMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      if (!overlaySyntheticMoveRelayActive && !draggingStickerId()) {
          relayOverlaySyntheticPointerMove(e);
      }
      handleDragMove(e);
      handleSelectionMove(e);
  };

  const handleGlobalMouseUp = (e: MouseEvent) => {
      handleDragEnd();
      handleSelectionEnd(e);
      resetOverlaySyntheticPointerState();

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

      armStickerKeyboardDelete();
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
  };



  const resolveUnitImage = (id: string, visited = new Set<string>()): string | undefined => {
      // Loop Detection
      if (visited.has(id)) return undefined;
      visited.add(id);

      const u = graphStore.units.find(u => u.id === id);
      if (!u) return undefined;

      // 1. Generated Result (Highest Priority)
      if (u.data.previewSrc) {
        return u.data.previewSrc;
      }

      // 2. Upstream Resolution (Pass-Through)
      // Check connected inputs BEFORE falling back to 'src' (Original Screenshot)
      // Fix potential undefined artId access with optional chaining and fallback
      const capability = u.type === "art" ? graphStore.capabilities.find((item) => item.id === u.artId) : undefined;
      const inputs = u.inputs || (u.type === 'art' ? capability?.inputs || [] : []) || [{ name: 'image' }];

      // Try to find a connected input that provides an image
      // Priority: 'image', 'input_image', or just the first connected one
      const link = graphStore.links.find(l =>
          l.toUnitId === id &&
          (l.toPortId === 'image' || l.toPortId === 'input_image' || l.toPortId === 'input')
      );

      if (link) {
          const upstream = resolveUnitImage(link.fromUnitId, visited);
          if (upstream) return upstream;
      }

      // 3. Fallback to Source (Original Screenshot / Upload)
      // If no result and no upstream image, show original
      return u.data.src;
  };

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
                <div
                    style={{
                        position: "fixed",
                        inset: "0",
                        "z-index": "2147483647",
                        background: "rgba(120,0,0,0.95)",
                        color: "#fff",
                        font: "12px/1.5 monospace",
                        "white-space": "pre-wrap",
                        overflow: "auto",
                        padding: "16px",
                    }}
                >
                    {"render-error (click 重试 to recover)\n\n" + detail}
                    <div style={{ "margin-top": "12px" }}>
                        <button
                            type="button"
                            style={{
                                background: "#fff",
                                color: "#900",
                                padding: "4px 12px",
                                "border-radius": "6px",
                            }}
                            onClick={reset}
                        >
                            重试
                        </button>
                    </div>
                </div>
            );
        }}
    >
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

        <div id="ports-layer" ref={portsLayerRef!} class="absolute inset-0 z-[5] pointer-events-none overflow-visible"></div>

        <CanvasUnits
            onStartDrag={onStartDragUnit}
            onDoubleClick={handleDoubleClick}

            onDelete={(id) => {
                graphStore.actions.removeUnit(id);
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
                graphStore.actions.updateUnitData(id, {
                    previewSrc: dataUrl,
                    processing: false,
                    progress: 1,
                    nodeStatus: "completed",
                    errorMessage: undefined,
                });
                propagateFromUnit(id);
                void syncService.performWorkflowSync();
            }}

            resolveUnitImage={resolveUnitImage}
            portsLayerRef={portsLayerRef}
        />

        {/* Layer 3: Selection Overlay */}
        <CanvasSelection />

        <Show when={longCaptureSession()}>
            {(session) => (
                <div class="hook-terminal-shell hook-terminal-shell--strong hook-capture-status-shell absolute right-5 top-5 z-[120] px-4 py-3 text-xs pointer-events-none">
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

        {/* DEBUG: Visual Mouse Tracker Removed */}
    </main>
    </ErrorBoundary>
  );
}
