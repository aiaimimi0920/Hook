import { Component, For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { graphStore } from "../store/graphStore";
import {
  activeStickerEditTargetId,
  enhancementNotices,
  isCleanView,
  isSelecting,
  longCaptureSession,
  selectionActions,
  selectedStickerAnnotationId,
  selectedStickerAnnotationIds,
  stickerToolSettings,
  uiActions,
} from "../store/uiStore";
import { Unit, Link } from "../types/unit";
import { ArtCapability } from "../services/protocol";
import { addOrUpdateRect, removeRect, updatePortOffset } from "../services/uiRegistry";
import { computeMinifiedStickerAnnotationViewport, computeMinifiedStickerViewport } from "../services/stickerEditing";
import { ShaderPreview } from "./ShaderPreview";
import { UnitParamsPanel } from "./UnitParamsPanel";
import { UnitAddNodeMenu } from "./UnitAddNodeMenu";
import { UnitPorts } from "./UnitPorts";
import { StickerAnnotationLayer } from "./StickerAnnotationLayer";
import { StickerTopStrip } from "./StickerTopStrip";
import { DISABLED_PREFIX } from "../constants";
import { isStickerSurfaceDoubleClickTarget } from "../services/stickerDoubleClick";
import { resolveEffectiveNodeParams } from "../services/graphImageResolution";
import { normalizeImageSourceForDisplay } from "../services/imageSource";
import { api, isTauriRuntimeAvailable } from "../services/api";
import { stickerContextMenuController } from "../services/stickerContextMenuController";
import { renderStickerComposite } from "../services/stickerExport";

interface Props {
  unit: Unit;
  params: Record<string, any>; // Direct Store reference for reactivity
  execConfig?: {  // Separate store for execution config (avoids re-render flickering)
      triggerMode: { upstreamDriven: boolean; paramDriven: boolean };
      propagation: { listenUpstream: boolean; notifyDownstream: boolean };
      __expanded: boolean;
  };
  capability?: ArtCapability; // Metadata for Art nodes
  isSelected: boolean;
  showActions: boolean;
  showParams: boolean; // NEW: Toggle state for params
  onMouseDown: (e: MouseEvent) => void;
  onParamChange: (propId: string, value: any, isFinal?: boolean) => void;
  onDoubleTap: (e: MouseEvent) => void;
  onDelete: () => void;
  onAddNode: (artId: string) => void;
  onLinkStart: (propId: string, startX: number, startY: number) => void;
  onLinkDrop: (propId: string) => void; // NEW: Robust Link Completion
  onLinkMove?: (portId: string, e: MouseEvent) => void; // NEW: Re-linking (Optional)
  onLinkHover: (targetId: string | null) => void; // NEW: Visualization feedback
  onRendered: (id: string, dataUrl: string) => void;
  onResize: (nextFrame: Pick<Unit, "x" | "y" | "w" | "h">) => void; // NEW: Ctrl+Wheel Resize with Pivot
  onOpacityChange: (opacity: number) => void; // NEW: Alt+Wheel Opacity
  availableArts?: ArtCapability[]; // NEW: List of available arts for the menu
  resolveUnitImage?: (unitId: string) => string | undefined; // NEW: Helper to resolve referenced images

  multiDragPositions?: Record<string, {x: number; y: number}> | null; // Multi-Drag State
  connectedPorts?: string[]; // List of connected INPUT ports
  connectedLinks?: Link[]; // NEW: Full Links for resolving upstream units
  portsLayer?: HTMLElement; // NEW: Global Layer for Z-independent ports
}

export const UnitView: Component<Props> = (props) => {
  let unitContainerRef: HTMLDivElement | undefined;
  let nativeStickerDragStart:
      | {
            x: number;
            y: number;
            pointerId?: number;
            started: boolean;
        }
      | null = null;
  let nativeStickerDragInFlight = false;
  const [nativeStickerExportPreview, setNativeStickerExportPreview] = createSignal<{
      x: number;
      y: number;
      src: string;
      width: number;
      height: number;
  } | null>(null);
  type NativeDragPreflightOverlayPayload = {
      x?: number;
      y?: number;
      globalX?: number;
      globalY?: number;
      shiftKey?: boolean;
  };
  const logWheelEvent = (phase: string, detail: string) => {
      void api.debugLogEvent("sticker-wheel-trace", `layer=unit phase=${phase} unit=${props.unit.id} ${detail}`);
  };



  const isArt = () => props.unit.type === 'art';
  const liveUnit = () => graphStore.units.find((unit) => unit.id === props.unit.id) || props.unit;
  const isMinified = () => !!liveUnit().data.minified;
  const hasSelectedExistingAnnotations = () =>
      selectedStickerAnnotationIds.length > 0 || selectedStickerAnnotationId() !== null;
  const shouldBlockContainerMouseDown = () => {
      if (props.unit.type !== "sticker") return false;
      if (activeStickerEditTargetId() !== props.unit.id) return false;
      if (stickerToolSettings.domain !== "existing") {
          if (stickerToolSettings.domain === "create") return true;
          return stickerToolSettings.activeCanvasTool !== "idle";
      }
      if (stickerToolSettings.transformMode !== "select") return true;
      return hasSelectedExistingAnnotations();
  };
  const allowContainerMouseDown = () => !shouldBlockContainerMouseDown();
  const handleUnitDoubleClick = (event: MouseEvent) => {
      if (props.unit.type === "sticker" && !isStickerSurfaceDoubleClickTarget(event.target, event.currentTarget)) {
          event.stopPropagation();
          return;
      }
      props.onDoubleTap(event);
  };
  const showSelectionBorder = () => true;
  const isShaderArt = () => isArt() && props.capability?.execution_type === 'shader';
  const effectiveParams = () =>
      isArt()
          ? resolveEffectiveNodeParams({
                units: graphStore.units,
                links: graphStore.links,
                capabilities: graphStore.capabilities,
                unitId: props.unit.id,
                manualParams: props.params,
            })
          : props.params;
  const getArtId = () => props.unit.artId;
  const getArtErrorMessage = () => liveUnit().data.errorMessage || "Art execution failed";
  const getConnectedImageForPort = (portName: string) => {
      const link = props.connectedLinks?.find((candidate) => candidate.toPortId === portName);
      return link ? props.resolveUnitImage?.(link.fromUnitId) : undefined;
  };
  const getShaderInputSrc = () =>
      getConnectedImageForPort("input") ||
      getConnectedImageForPort("input_image") ||
      getConnectedImageForPort("image") ||
      liveUnit().data.src ||
      "";
  const getShaderReferenceSrc = () => {
      const connected = getConnectedImageForPort("reference");
      if (connected) return connected;

      const reference = props.params.reference;
      if (typeof reference !== "string" || reference.length === 0) return undefined;
      return props.resolveUnitImage?.(reference) || reference;
  };
  const getCapabilityArtPath = () => {
      const artPath = props.capability?.execution?.artPath;
      return typeof artPath === "string" && artPath.length > 0 ? artPath : undefined;
  };
  const isContextualShader = () =>
      !!props.capability?.params?.some((param) => param.widget === "image_link" || param.id === "reference") ||
      !!props.capability?.inputs?.some((input) => input.name === "reference");

  // Dynamic Style for the container
  const currentPos = () => {
    // Check Multi-Drag (Unified)
    if (props.multiDragPositions && props.multiDragPositions[props.unit.id]) {
        return props.multiDragPositions[props.unit.id];
    }

    const unit = liveUnit();
    return { x: unit.x, y: unit.y };
  };

  const style = () => {
    const { x, y } = currentPos();
    const unit = liveUnit();

    return {
        left: `${x}px`,
        top: `${y}px`,
        width: `${unit.w}px`,
        // FIX: Force fixed height when minified (for crop), otherwise auto (for layout)
        height: isMinified() ? `${unit.h}px` : "auto",
        "z-index": props.isSelected ? 1000 : 10,
        position: "absolute" as const,
        // FIX: Disable transition during drag for instant tracking (Redundant if CSS removed, but safe)
        // FIX: Disable transition fully to ensure links track instantly with resize
        transition: "none",

        "overflow": isMinified() ? "hidden" : "visible", // CRITICAL: Minified = Clip Image; Normal = Show Ports (if not portal)
        // OVERRIDE: Prevent min-width from breaking minified size
        ...(isMinified() ? { "min-width": "0", "min-height": "0" } : {})
    };
  };

  const getOpacity = () => isMinified()
      ? (liveUnit().data.opacityMini ?? 0.9)
      : (liveUnit().data.opacityNormal ?? 1);
  const getImageEditState = () => liveUnit().data.imageEditState;
  const getCornerRadius = () => getImageEditState()?.cornerRadius ?? 0;
  const getImageBorderWidth = () => getImageEditState()?.borderWidth ?? 0;
  const getImageBorderColor = () => getImageEditState()?.borderColor ?? "transparent";
  const getCropRect = () => getImageEditState()?.cropRect;
  const getCropSourceSize = () => getImageEditState()?.sourceSize;
  const getTransform = () => {
      const scaleX = getImageEditState()?.flippedX ? -1 : 1;
      const scaleY = getImageEditState()?.flippedY ? -1 : 1;
      return `scale(${scaleX}, ${scaleY})`;
  };
  const getMinifiedViewport = () =>
      computeMinifiedStickerViewport(
          liveUnit().data.savedRect,
          liveUnit().data.cropOffset,
          getImageEditState(),
      );
  const getMinifiedAnnotationViewport = () =>
      computeMinifiedStickerAnnotationViewport(
          { w: liveUnit().w, h: liveUnit().h },
          liveUnit().data.savedRect,
          liveUnit().data.cropOffset,
      );

  // === PORT LOGIC ===
  // Derive ports from capability if available, or default
  const getInputs = () => {
      // Stickers NOW support Input (Override Mode)
      if (!isArt()) {
           return [{ name: "image", label: "Image", type: "image", description: "Input image source" }];
      }
      if (props.capability?.inputs) return props.capability.inputs;
      // Default Art Input (single image if not specified)
      return [{ name: "input_image", label: "Input", type: "image" }];
  };

  const getOutputs = () => {
      // Stickers NOW support Output (Pass-through)
      if (!isArt()) {
           return [{ name: "output_image", label: "Image", type: "image" }];
      }
      if (props.capability?.outputs) return props.capability.outputs;
      // All nodes output Image by default currently
      return [{ name: "output_image", label: "Image", type: "image" }];
  };

  // Helper to determine Source Image (Screen vs Manual Override)
  // Priority:
  // 1. Input Connection (Upstream) -> Use Data Src (as result)
  // 2. Manual File -> Use Params
  // 3. Screenshot (Default) -> Use Data Src
  const displaySrc = () => {
      let resolvedSrc: string | undefined;
      // Check for Manual Override in Image Units
      if (!isArt()) {
          // Check if Image Input is explicitly disabled
          const isImageDisabled = props.unit.params["image"] === DISABLED_PREFIX;

          if (!isImageDisabled) {
              // If Input Connected, ignore Manual override (Input Priority)
              // We check if "image" input is connected
              const imageInput = getInputs().find(i => i.name === 'image');
              if (imageInput && props.connectedLinks) {
                   // Find link targeting this input port
                   const link = props.connectedLinks.find(l => l.toPortId === imageInput.name);
                   if (link && props.resolveUnitImage) {
                       const src = props.resolveUnitImage(link.fromUnitId);
                       if (src) {
                           resolvedSrc = src;
                       }
                   }
              }

              // If NOT connected, check Manual
              const path = props.params.image_path;
              if (path && path.startsWith("data:")) {
                  resolvedSrc = path;
              }
          }
      }
      if (!resolvedSrc) {
          resolvedSrc = liveUnit().data.previewSrc || liveUnit().data.src || "";
      }
      return normalizeImageSourceForDisplay(resolvedSrc) || "";
  };
  const baseImageSrc = () =>
      liveUnit().data.rasterizedAnnotationLayerSrc
          ? normalizeImageSourceForDisplay(liveUnit().data.src || displaySrc()) || ""
          : displaySrc();
  const fileBackedFallbacksInFlight = new Set<string>();
  const handleFileBackedImageLoadError = async () => {
      const unit = liveUnit();
      const filePath = unit.data.filePath;
      if (!filePath || unit.data.previewSrc?.startsWith("data:")) {
          return;
      }
      if (fileBackedFallbacksInFlight.has(unit.id)) {
          return;
      }

      fileBackedFallbacksInFlight.add(unit.id);
      try {
          const fallbackSrc = await api.readImageFromPath(filePath);
          graphStore.actions.updateUnitData(props.unit.id, {
              previewSrc: fallbackSrc,
          });
      } catch (error) {
          console.warn("[UnitView] Failed to load file-backed image fallback", error);
      } finally {
          fileBackedFallbacksInFlight.delete(unit.id);
      }
  };

  const detachPendingNativeDragListeners = () => {
      if (typeof window === "undefined") return;
      window.removeEventListener("pointermove", handlePendingNativeDragPointerMove, true);
      window.removeEventListener("mousemove", handlePendingNativeDragPointerMove, true);
      window.removeEventListener("pointerup", handlePendingNativeDragEnd, true);
      window.removeEventListener("mouseup", handlePendingNativeDragEnd, true);
      window.removeEventListener("pointercancel", handlePendingNativeDragEnd, true);
      window.removeEventListener("hook:overlay-native-drag-preflight-move", handlePendingNativeDragOverlayMove as EventListener, true);
      window.removeEventListener("hook:overlay-native-drag-preflight-up", handlePendingNativeDragOverlayEnd as EventListener, true);
  };

  const clearPendingNativeStickerDrag = () => {
      nativeStickerDragStart = null;
      setNativeStickerExportPreview(null);
      void api.setNativeStickerDragPreflight(false);
      detachPendingNativeDragListeners();
  };

  const overlayPayloadClientPoint = (detail: NativeDragPreflightOverlayPayload | undefined) => {
      const x = detail?.x ?? detail?.globalX;
      const y = detail?.y ?? detail?.globalY;
      if (typeof x !== "number" || typeof y !== "number") return null;
      return { x, y };
  };

  const pointTargetsThisUnit = (x: number, y: number) => {
      if (!unitContainerRef) return false;
      const target = document.elementFromPoint(x, y);
      if (target instanceof Element) {
          const unitRoot = target.closest(".unit-container");
          if (unitRoot) {
              return unitRoot === unitContainerRef;
          }
      }
      const rect = unitContainerRef.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  const attachPendingNativeDragListeners = () => {
      if (typeof window === "undefined") return;
      detachPendingNativeDragListeners();
      window.addEventListener("pointermove", handlePendingNativeDragPointerMove, true);
      window.addEventListener("mousemove", handlePendingNativeDragPointerMove, true);
      window.addEventListener("pointerup", handlePendingNativeDragEnd, true);
      window.addEventListener("mouseup", handlePendingNativeDragEnd, true);
      window.addEventListener("pointercancel", handlePendingNativeDragEnd, true);
      window.addEventListener("hook:overlay-native-drag-preflight-move", handlePendingNativeDragOverlayMove as EventListener, true);
      window.addEventListener("hook:overlay-native-drag-preflight-up", handlePendingNativeDragOverlayEnd as EventListener, true);
  };

  const beginPendingHookStickerExportDrag = (x: number, y: number, pointerId?: number) => {
      if (nativeStickerDragInFlight) return;
      void api.debugLogEvent(
          "sticker-export-drag-capture",
          `unit=${props.unit.id} x=${x} y=${y} pathFirst=${!!resolveExistingNativeDragFilePath()}`,
      );
      nativeStickerDragStart = { x, y, pointerId, started: false };
      setNativeStickerExportPreview(null);
      void api.setNativeStickerDragPreflight(true);
      attachPendingNativeDragListeners();
  };

  const buildNativeStickerDragFilenameHint = () => {
      let label = props.unit.type === "art" && props.capability?.label
          ? props.capability.label
          : "image";
      label = label.toLowerCase().replace(/[^a-z0-9]/g, "");
      const suffix = props.unit.id.slice(-4);
      return `${label || "image"}_${suffix}`;
  };

  const resolveExistingNativeDragFilePath = () => {
      const unit = liveUnit();
      if (unit.data.dragOutFilePath) {
          return unit.data.dragOutFilePath;
      }
      if (!unit.data.filePath) return false;
      if (unit.data.rasterizedAnnotationLayerSrc) return false;
      if ((unit.data.annotationState?.elements?.length || 0) > 0) return false;

      const imageEditState = unit.data.imageEditState;
      if (!imageEditState) return unit.data.filePath;

      if ((imageEditState.contentEraseStrokes?.length || 0) > 0) return false;
      if (imageEditState.cropRect) return false;
      if (imageEditState.flippedX || imageEditState.flippedY) return false;
      if ((imageEditState.borderWidth || 0) > 0) return false;
      if ((imageEditState.cornerRadius || 0) > 0) return false;
      if (imageEditState.beautify?.enabled) return false;

      return unit.data.filePath;
  };

  const beginHookStickerExportDrag = async (globalX: number, globalY: number) => {
      if (nativeStickerDragInFlight) return;

      nativeStickerDragInFlight = true;
      try {
          const unit = liveUnit();
          const existingDragPath = resolveExistingNativeDragFilePath();
          const useExistingPath = typeof existingDragPath === "string" && existingDragPath.length > 0;
          void api.debugLogEvent(
              "sticker-export-drag-request",
              `unit=${props.unit.id} x=${globalX} y=${globalY} pathFirst=${useExistingPath} hasFilePath=${!!unit.data.filePath} hasDragOutFilePath=${!!unit.data.dragOutFilePath}`,
          );
          const path = useExistingPath
               ? await api.saveStickerDragExportFromPath(
                     existingDragPath as string,
                     buildNativeStickerDragFilenameHint(),
                     globalX,
                     globalY,
                 )
               : await (async () => {
                   const exportBase64 = await renderStickerComposite(unit);
                   return api.saveStickerDragExport(
                       exportBase64,
                       buildNativeStickerDragFilenameHint(),
                       globalX,
                       globalY,
                   );
               })();
          if (!useExistingPath) {
              graphStore.actions.updateUnitData(props.unit.id, {
                  dragOutFilePath: path,
              });
          }
          void api.debugLogEvent("sticker-export-drag-saved", `unit=${props.unit.id} path=${path}`);
      } catch (error) {
          console.error("Hook sticker export drag failed", error);
          void api.debugLogEvent(
              "sticker-export-drag-failed",
              `unit=${props.unit.id} error=${error instanceof Error ? error.message : String(error)}`,
          );
      } finally {
          nativeStickerDragInFlight = false;
      }
  };

  const updateHookStickerExportDragPreview = (x: number, y: number) => {
      const start = nativeStickerDragStart;
      if (!start || nativeStickerDragInFlight) return;
      if (!start.started && Math.hypot(x - start.x, y - start.y) < 6) {
          return;
      }

      if (!start.started) {
          start.started = true;
          void api.debugLogEvent("sticker-export-drag-started", `unit=${props.unit.id} x=${x} y=${y}`);
      }

      const maxPreviewSize = 140;
      const scale = Math.min(1, maxPreviewSize / Math.max(props.unit.w, props.unit.h, 1));
      setNativeStickerExportPreview({
          x,
          y,
          src: baseImageSrc(),
          width: Math.max(24, props.unit.w * scale),
          height: Math.max(24, props.unit.h * scale),
      });
  };

  const handlePendingNativeDragPointerMove = (event: PointerEvent | MouseEvent) => {
      const start = nativeStickerDragStart;
      if (!start || nativeStickerDragInFlight) return;
      if ("pointerId" in event && start.pointerId !== undefined && event.pointerId !== start.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      updateHookStickerExportDragPreview(event.clientX, event.clientY);
  };

  const handlePendingNativeDragOverlayMove = (event: Event) => {
      const start = nativeStickerDragStart;
      if (!start || nativeStickerDragInFlight) return;
      const detail = (event as CustomEvent<NativeDragPreflightOverlayPayload>).detail;
      const point = overlayPayloadClientPoint(detail);
      if (!point) return;
      updateHookStickerExportDragPreview(point.x, point.y);
  };

  const handlePendingNativeDragEnd = (event?: PointerEvent | MouseEvent) => {
      if (
          event &&
          nativeStickerDragStart &&
          "pointerId" in event &&
          nativeStickerDragStart.pointerId !== undefined &&
          event.pointerId !== nativeStickerDragStart.pointerId
      ) {
          return;
      }
      const point = event ? { x: event.clientX, y: event.clientY } : null;
      const shouldExport = !!nativeStickerDragStart?.started && !!point;
      clearPendingNativeStickerDrag();
      if (shouldExport && point) {
          void beginHookStickerExportDrag(point.x, point.y);
      }
  };

  const handlePendingNativeDragOverlayDown = (event: Event) => {
      if (props.unit.type !== "sticker" || !isTauriRuntimeAvailable()) return;
      const detail = (event as CustomEvent<NativeDragPreflightOverlayPayload>).detail;
      if (!detail?.shiftKey) return;
      const point = overlayPayloadClientPoint(detail);
      if (!point || !pointTargetsThisUnit(point.x, point.y)) return;
      beginPendingHookStickerExportDrag(point.x, point.y);
  };

  const handlePendingNativeDragOverlayEnd = (event?: Event) => {
      const detail = (event as CustomEvent<NativeDragPreflightOverlayPayload> | undefined)?.detail;
      const point = overlayPayloadClientPoint(detail);
      const shouldExport = !!nativeStickerDragStart?.started && !!point;
      clearPendingNativeStickerDrag();
      if (shouldExport && point) {
          void beginHookStickerExportDrag(point.x, point.y);
      }
  };

  const handleNativeStickerPointerDownCapture = (event: PointerEvent) => {
      if (props.unit.type !== "sticker" || !isTauriRuntimeAvailable() || !event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      beginPendingHookStickerExportDrag(event.clientX, event.clientY, event.pointerId);
  };

  createEffect(() => {
      if (props.unit.type !== "sticker") return;
      unitContainerRef?.addEventListener("pointerdown", handleNativeStickerPointerDownCapture, true);
      window.addEventListener("hook:overlay-native-drag-preflight-down", handlePendingNativeDragOverlayDown as EventListener, true);
      onCleanup(() => {
          unitContainerRef?.removeEventListener("pointerdown", handleNativeStickerPointerDownCapture, true);
          window.removeEventListener("hook:overlay-native-drag-preflight-down", handlePendingNativeDragOverlayDown as EventListener, true);
      });
  });

  onCleanup(() => {
      detachPendingNativeDragListeners();
  });

  const getRenderedImageFrame = () => {
      const ocr = props.unit.data.ocrResult;
      if (!ocr?.width || !ocr?.height) {
          return null;
      }

      if (isMinified()) {
          return {
              left: 0,
              top: 0,
              width: props.unit.w,
              height: props.unit.h,
              scaleX: props.unit.w / ocr.width,
              scaleY: props.unit.h / ocr.height,
          };
      }

      const scale = Math.min(props.unit.w / ocr.width, props.unit.h / ocr.height);
      const width = ocr.width * scale;
      const height = ocr.height * scale;

      return {
          left: (props.unit.w - width) / 2,
          top: (props.unit.h - height) / 2,
          width,
          height,
          scaleX: scale,
          scaleY: scale,
      };
  };

  const getOcrBlockBounds = (block: { boxPoints: { x: number; y: number }[] }) => {
      const xs = block.boxPoints.map((point) => point.x);
      const ys = block.boxPoints.map((point) => point.y);
      return {
          minX: Math.min(...xs),
          maxX: Math.max(...xs),
          minY: Math.min(...ys),
          maxY: Math.max(...ys),
      };
  };

  // NEW: Helper to register Panel Port Offsets for stable linking
  const registerPanelPort = (el: HTMLElement, portName: string) => {
      const update = () => {
          if (!el.isConnected) return; // Cleanup check
          const unit = el.closest('.unit-container');
          if (!unit) return;

          const rPort = el.getBoundingClientRect();
          const rUnit = unit.getBoundingClientRect();

          // Calculate Center Relative to Unit Top-Left
          const relX = (rPort.left + rPort.width/2) - rUnit.left;
          const relY = (rPort.top + rPort.height/2) - rUnit.top;

          // Check for NaN or crazy values
          if (isNaN(relX) || isNaN(relY)) return;

          updatePortOffset(props.unit.id, portName, {x: relX, y: relY});
      };

      // Run immediately and after short delay (for layout settlement)
      update();
      requestAnimationFrame(update);
      setTimeout(update, 50); // Fallback for delayed rendering
  };


  // Register active panels for click-through prevention (One-Stop Solution)

    // FIX: Re-calculate Panel Port Offsets when Unit Resizes (Fit Frame / Drag)
    createEffect(() => {
        // Dependencies
        // We need to wait for DOM Reflow, similar to registerPanelPort logic
        if (unitContainerRef) {
            requestAnimationFrame(() => {
                const ports = unitContainerRef?.querySelectorAll('[data-panel-port="true"]');
                ports?.forEach((el) => {
                    const name = el.getAttribute('data-port-name');
                    if (name) registerPanelPort(el as HTMLElement, name);
                });
            });
        }
    });

  createEffect(() => {
       const u = props.unit;

       // INPUT PORTS (Left strip for hit testing)
       const inputCount = getInputs().length;
       if (inputCount > 0) {
            getInputs().forEach((p, i) => {
                const portY = u.y + 24 + (i * (36));
                addOrUpdateRect({
                    id: `port-in-${u.id}-${i}`,
                    x: u.x - 18,
                    y: portY,
                    width: 18,
                    height: 24,
                    name: `PORT_IN_${p.name}`
                });
            });
       }

       // OUTPUT PORTS (Right strip)
       getOutputs().forEach((p, i) => {
            const portY = u.y + 24 + (i * (36));
            addOrUpdateRect({
                id: `port-out-${u.id}-${i}`,
                x: u.x + u.w,
                y: portY,
                width: 18,
                height: 24,
                name: `PORT_OUT_${p.name}`
            });
       });

       onCleanup(() => {
           getInputs().forEach((_, i) => removeRect(`port-in-${u.id}-${i}`));
           getOutputs().forEach((_, i) => removeRect(`port-out-${u.id}-${i}`));
       });
  });

  return (
    <div
      class={`unit-container ${props.isSelected ? "selected" : ""} ${isArt() ? "art-node" : "sticker-node"} ${isMinified() ? "minified" : ""}`}
      style={style()}

      ref={unitContainerRef}

      data-unit-id={props.unit.id} // NEW: For global hit-testing (Link Node)
      tabIndex={-1}
      onMouseDown={(event) => {
        if (allowContainerMouseDown()) {
            props.onMouseDown(event);
        }
      }}
      onContextMenu={(event) => {
        if (props.unit.type !== "sticker") return;
        event.preventDefault();
        event.stopPropagation();
        if (isSelecting() || longCaptureSession()?.active) return;
        selectionActions.set([props.unit.id]);
        stickerContextMenuController.openForSticker(props.unit.id, {
            x: event.clientX,
            y: event.clientY,
        });
      }}
      onDblClick={handleUnitDoubleClick}
      onWheel={(e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();

            logWheelEvent(
                "ctrl-enter",
                `ctrl=${e.ctrlKey} alt=${e.altKey} shift=${e.shiftKey} minified=${isMinified()} activeEditTarget=${activeStickerEditTargetId() ?? "null"} selectedAnnotationCount=${selectedStickerAnnotationIds.length} primaryAnnotation=${selectedStickerAnnotationId() ?? "null"} deltaY=${e.deltaY}`,
            );
            if (isMinified()) return;
            const currentUnit = liveUnit();

            const rect = e.currentTarget.getBoundingClientRect();
            // Calculate scale of the view (in case canvas is zoomed)
            // If rect.width is 0 (hidden), safe fallback
            const viewScale = currentUnit.w > 0 ? rect.width / currentUnit.w : 1;

            // Mouse position relative to unit corner (in World Units)
            const relX = (e.clientX - rect.left) / viewScale;
            const relY = (e.clientY - rect.top) / viewScale;

            // Browser wheel direction: deltaY < 0 means wheel-up. Wheel-up should zoom in.
            const scaleFactor = Math.max(0.5, Math.min(1.5, Math.exp(-e.deltaY * 0.001)));

            const newW = Math.max(24, currentUnit.w * scaleFactor);
            const newH = Math.max(24, currentUnit.h * scaleFactor);

            // Calculate actual effective scale applied (in case of clamping)
            const effectiveScaleW = currentUnit.w > 0 ? newW / currentUnit.w : 1;
            const effectiveScaleH = currentUnit.h > 0 ? newH / currentUnit.h : 1;

            // New Position: Adjusted to keep the point under mouse stationary
            // NewUnitX = MouseX_World - (RelX_World * NewScale)
            // But MouseX_World = UnitX + RelX_World
            // So NewUnitX = UnitX + RelX_World - RelX_World * NewScale
            //             = UnitX + RelX_World * (1 - NewScale)
            const newX = currentUnit.x + relX * (1 - effectiveScaleW);
            const newY = currentUnit.y + relY * (1 - effectiveScaleH);
            const nextFrame = { x: newX, y: newY, w: newW, h: newH };

            logWheelEvent(
                "ctrl-resize",
                `ctrl=${e.ctrlKey} alt=${e.altKey} shift=${e.shiftKey} minified=${currentUnit.data.minified ?? false} relX=${relX.toFixed(2)} relY=${relY.toFixed(2)} nextW=${newW.toFixed(2)} nextH=${newH.toFixed(2)} nextX=${newX.toFixed(2)} nextY=${newY.toFixed(2)}`,
            );
            props.onResize(nextFrame);
        } else if (e.altKey) {
            e.preventDefault();
            e.stopPropagation();

            const currentUnit = liveUnit();
            const currentOp = currentUnit.data.minified
                ? (currentUnit.data.opacityMini ?? 0.9)
                : (currentUnit.data.opacityNormal ?? 1.0);

            // Step 0.05 per scroll click
            const delta = -e.deltaY * 0.001;
            const newOp = Math.max(0, Math.min(1, currentOp + delta));

            logWheelEvent(
                "alt-opacity",
                `ctrl=${e.ctrlKey} alt=${e.altKey} shift=${e.shiftKey} minified=${currentUnit.data.minified ?? false} currentOpacity=${currentOp.toFixed(3)} nextOpacity=${newOp.toFixed(3)} deltaY=${e.deltaY}`,
            );
            props.onOpacityChange(newOp);
        }
      }}
    >
        <Show when={nativeStickerExportPreview()}>
            {(preview) => (
                <Portal>
                    <div
                        class="hook-sticker-export-drag-preview"
                        style={{
                            position: "fixed",
                            left: `${preview().x + 18}px`,
                            top: `${preview().y + 18}px`,
                            width: `${preview().width}px`,
                            height: `${preview().height}px`,
                            "z-index": "2147483647",
                            "pointer-events": "none",
                            opacity: "0.86",
                            border: "1px solid rgba(219, 255, 0, 0.85)",
                            background: "rgba(0, 0, 0, 0.25)",
                            "box-shadow": "0 4px 16px rgba(0, 0, 0, 0.35)",
                        }}
                    >
                        <img
                            src={preview().src}
                            draggable={false}
                            style={{
                                width: "100%",
                                height: "100%",
                                "object-fit": "contain",
                                display: "block",
                            }}
                        />
                    </div>
                </Portal>
            )}
        </Show>
        <UnitPorts
            unit={props.unit}
            capability={props.capability}
            portsLayer={props.portsLayer}
            isCleanView={isCleanView()}

            x={currentPos().x}
            y={currentPos().y}
            width={props.unit.w}
            height={props.unit.h}

            onLinkStart={props.onLinkStart}
            onLinkDrop={props.onLinkDrop}
            onLinkMove={props.onLinkMove}
        />




        {(() => {

            return null;
        })()}

        {/* === VISUAL LAYER (Cropped Content) === */}
        <div class="sticker-visual" style={{
            width: "100%", height: `${props.unit.h}px`,
            "overflow": "hidden", // CRITICAL: Clipping for Windowing
            "position": "relative",
            "border-radius": `${getCornerRadius()}px`,
            "border": "none",
            "box-sizing": "border-box",
            "background": "transparent",
            "opacity": getOpacity(),
            "z-index": "1" // Ensure it covers the tucked-under ports
        }}>
            {/* SHADER ART: Use ShaderPreview for real-time rendering */}
            <Show when={isShaderArt() && getArtId()}>
                {/* Wrapper for Crop/Minify Logic - Mimics img tag behavior */}
                <div style={(() => {
                    if (isMinified()) {
                         const viewport = getMinifiedViewport();
                         return {
                             "position": "absolute",
                             "width": `${viewport.width}px`,
                             "height": `${viewport.height}px`,
                             "left": `-${viewport.offsetX}px`,
                             "top": `-${viewport.offsetY}px`,
                             "pointer-events": "auto"
                         };
                    }
                    return { "width": "100%", "height": "100%" };
                })()}>
                    <ShaderPreview
                        unitId={props.unit.id}
                        artId={getArtId()!}
                        params={effectiveParams()}
                        artPath={getCapabilityArtPath()}
                        inputImageSrc={getShaderInputSrc()}
                        referenceImageSrc={getShaderReferenceSrc()}
                        requiresReference={isContextualShader()}
                        width={isMinified() ? getMinifiedViewport().width : props.unit.w}
                        height={isMinified() ? getMinifiedViewport().height : props.unit.h}
                        opacity={1}
                        resolveUnitImage={props.resolveUnitImage}
                        onRendered={(dataUrl) => props.onRendered(props.unit.id, dataUrl)}
                    />
                </div>
            </Show>

            {/* Standard Image Layer (hidden for Shader Arts) */}
            <Show when={!isShaderArt()}>
            <img
                class="sticker-img"
                // Drag-Out to Save (HTML5 Drag)
                draggable={!isTauriRuntimeAvailable()}
                onDragStart={(e) => {
                    if (isTauriRuntimeAvailable()) {
                        e.preventDefault();
                        return;
                    }

                    // Only standard drag if Shift is held (Now: Shift = Drag Out)
                    if (!e.shiftKey) {
                        e.preventDefault();
                        return;
                    }

                    e.dataTransfer!.effectAllowed = "all"; // Allow Copy, Move, Link (Fixes Alt key forbidden cursor?)
                    e.dataTransfer!.clearData(); // CRITICAL: Clear browser default (which causes 'download' name)

                    // Construct DownloadURL
                    // Mime:FileName:Url

                    // ... (Counter logic same)
                    if (!(window as any)._nodeSaveCounts) (window as any)._nodeSaveCounts = {};
                    const counts = (window as any)._nodeSaveCounts;
                    const count = (counts[props.unit.id] || 0) + 1;
                    counts[props.unit.id] = count;

                    // Construct Filename: label_suffix_count.png
                    // 1. Get Base Label (e.g. "Pixelate" or "Image")
                    let label = props.unit.type === 'art' && props.capability?.label
                        ? props.capability.label
                        : "image";

                    // 2. Sanitize (lowercase, remove non-alphanumeric)
                    label = label.toLowerCase().replace(/[^a-z0-9]/g, '');

                    // 3. Get ID Suffix (last 4 chars)
                    const suffix = props.unit.id.slice(-4);

                    const filename = `${label}_${suffix}_${count}.png`;

                    const src = props.unit.data.previewSrc || props.unit.data.src || "";
                    const dragOutFilePath = props.unit.data.filePath;

                    if (dragOutFilePath) {
                         const normalizedFilePath = dragOutFilePath.replace(/\\/g, "/").startsWith("/")
                             ? dragOutFilePath.replace(/\\/g, "/")
                             : `/${dragOutFilePath.replace(/\\/g, "/")}`;
                         const fileUrl = encodeURI(`file://${normalizedFilePath}`);
                         const dlUrl = `image/png:${filename}:${fileUrl}`;

                         e.dataTransfer!.setData("DownloadURL", dlUrl);
                         e.dataTransfer!.setData("text/uri-list", fileUrl);
                         e.dataTransfer!.setData("text/plain", dragOutFilePath);
                         return;
                    }

                    if (src.startsWith("data:")) {
                         const mime = src.split(";")[0].split(":")[1] || "image/png";

                         // Convert Base64 to Blob URL to bypass data transfer size limits
                         try {
                             const byteString = atob(src.split(',')[1]);
                             const ab = new ArrayBuffer(byteString.length);
                             const ia = new Uint8Array(ab);
                             for (let i = 0; i < byteString.length; i++) {
                                 ia[i] = byteString.charCodeAt(i);
                             }
                             const blob = new Blob([ab], { type: mime });
                             const blobUrl = URL.createObjectURL(blob);

                             const dlUrl = `${mime}:${filename}:${blobUrl}`;
                             e.dataTransfer!.setData("DownloadURL", dlUrl);
                         } catch (err) {
                             console.error("Failed to create blob for drag:", err);
                             // Fallback to original data URI
                             const dlUrl = `${mime}:${filename}:${src}`;
                             e.dataTransfer!.setData("DownloadURL", dlUrl);
                         }

                         // Re-add text/uri-list for wide compatibility
                         e.dataTransfer!.setData("text/uri-list", src);

                         return;
                    }
                }}
                src={baseImageSrc()}
                onError={handleFileBackedImageLoadError}
                style={(() => {
                    if (isMinified()) {
                        // MINIFIED: Crop View
                        const viewport = getMinifiedViewport();
                        return {
                            "position": "absolute",
                            "width": `${viewport.width}px`,
                            "height": `${viewport.height}px`,
                            // CRITICAL: Force original size to ensure CROP not SCALE
                            "min-width": `${viewport.width}px`,
                            "min-height": `${viewport.height}px`,
                            "max-width": "none",
                            "max-height": "none",

                            "left": `-${viewport.offsetX}px`,
                            "top": `-${viewport.offsetY}px`,

                            "pointer-events": "auto",
                            "object-fit": "fill", // Use fill to force exact dimensions designated above
                            "transform": getTransform()
                        };
                    }
                    const cropRect = getCropRect();
                    const cropSourceSize = getCropSourceSize();
                    if (cropRect && cropSourceSize) {
                        return {
                            "position": "absolute",
                            "width": `${cropSourceSize.w}px`,
                            "height": `${cropSourceSize.h}px`,
                            "left": `-${cropRect.x}px`,
                            "top": `-${cropRect.y}px`,
                            "min-width": `${cropSourceSize.w}px`,
                            "min-height": `${cropSourceSize.h}px`,
                            "max-width": "none",
                            "max-height": "none",
                            "pointer-events": "auto",
                            "object-fit": "fill",
                            "transform": getTransform()
                        };
                    }
                    return {
                        "width": "100%",
                        "height": "100%",
                        "object-fit": "contain",
                        "max-width": "100%",
                        "max-height": "100%",
                        "pointer-events": "auto",
                        "transform": getTransform()
                    };
                })()}
            />
            </Show>

            <Show when={!isShaderArt() && liveUnit().data.rasterizedAnnotationLayerSrc}>
                {(layerSrc) => (
                    <div
                        class="sticker-rasterized-annotation-layer-viewport absolute"
                        style={(() => {
                            const viewport = isMinified()
                                ? getMinifiedAnnotationViewport()
                                : {
                                      width: props.unit.w,
                                      height: props.unit.h,
                                      offsetX: 0,
                                      offsetY: 0,
                                  };
                            return {
                                width: `${viewport.width}px`,
                                height: `${viewport.height}px`,
                                left: `-${viewport.offsetX}px`,
                                top: `-${viewport.offsetY}px`,
                                "pointer-events": "none",
                                "z-index": 11,
                            };
                        })()}
                    >
                        <img
                            class="sticker-rasterized-annotation-layer pointer-events-none absolute inset-0"
                            src={layerSrc()}
                            draggable={false}
                            style={{
                                width: "100%",
                                height: "100%",
                                "object-fit": "fill",
                                "max-width": "100%",
                                "max-height": "100%",
                            }}
                        />
                    </div>
                )}
            </Show>

            <Show when={getImageBorderWidth() > 0}>
                <div
                    class="pointer-events-none absolute inset-0 z-[12] box-border"
                    style={{
                        border: `${getImageBorderWidth()}px solid ${getImageBorderColor()}`,
                        "border-radius": `${getCornerRadius()}px`,
                    }}
                />
            </Show>

            <Show when={isArt() && liveUnit().data.nodeStatus === "error"}>
                <div
                    class="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center"
                    style={{
                        "z-index": 30,
                        "background-color": "rgba(15, 23, 42, 0.82)",
                        color: "#fecaca",
                    }}
                >
                    <div style={{ "max-height": "70%", overflow: "hidden" }}>
                        <div class="text-xs font-semibold" style={{ color: "#fca5a5" }}>
                            执行失败
                        </div>
                        <div class="mt-1 text-[11px] leading-snug break-words">
                            {getArtErrorMessage()}
                        </div>
                    </div>
                </div>
            </Show>

            <Show when={!isMinified() && props.unit.data.ocrResult?.textBlocks?.length}>
                <div
                    class="absolute inset-0 pointer-events-none"
                    style={{
                        "z-index": 15,
                    }}
                >
                    <For each={props.unit.data.ocrResult?.textBlocks || []}>{(block) => {
                        const frame = getRenderedImageFrame();
                        if (!frame) {
                            return null;
                        }

                        const bounds = getOcrBlockBounds(block);
                        const label = props.unit.data.showTranslated && block.translatedText
                            ? block.translatedText
                            : block.text;

                        return (
                            <div
                                class="absolute rounded-sm border border-white/40 shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
                                style={{
                                    left: `${frame.left + bounds.minX * frame.scaleX}px`,
                                    top: `${frame.top + bounds.minY * frame.scaleY}px`,
                                    width: `${Math.max((bounds.maxX - bounds.minX) * frame.scaleX, 18)}px`,
                                    height: `${Math.max((bounds.maxY - bounds.minY) * frame.scaleY, 18)}px`,
                                    color: block.colorHex,
                                    "background-color": `${block.bgColorHex}40`,
                                }}
                            >
                                <div
                                    class="absolute left-0 top-0 max-w-full truncate px-1 py-[1px] text-[10px] font-medium leading-tight"
                                    style={{
                                        color: block.colorHex,
                                        "background-color": `${block.bgColorHex}cc`,
                                    }}
                                    title={label}
                                >
                                    {label}
                                </div>
                            </div>
                        );
                    }}</For>
                </div>
            </Show>

            <Show when={enhancementNotices[props.unit.id]}>
                {(notice) => (
                    <div
                        class="enhancement-notice absolute left-2 right-2 top-2 rounded-xl border border-amber-300/35 bg-slate-950/90 p-3 text-left text-white shadow-2xl backdrop-blur-md"
                        style={{ "z-index": 40, "pointer-events": "auto" }}
                        onMouseDown={(event) => {
                            event.stopPropagation();
                        }}
                        onMouseUp={(event) => {
                            event.stopPropagation();
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                        }}
                        onDblClick={(event) => {
                            event.stopPropagation();
                        }}
                    >
                        <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                                <div class="text-[11px] font-semibold text-amber-100">
                                    {notice().title}
                                </div>
                                <div class="mt-1 text-[10px] leading-snug text-white/70">
                                    {notice().message}
                                </div>
                            </div>
                            <button
                                class="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                                onMouseDown={(event) => {
                                    event.stopPropagation();
                                }}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    uiActions.dismissEnhancementNotice(props.unit.id);
                                }}
                            >
                                知道了
                            </button>
                        </div>
                    </div>
                )}
            </Show>

            {/* Minified Border Overlay (Dashed, Rectangle) */}
            <Show when={isMinified()}>
                <div class="mini-overlay" style={{
                    "position": "absolute", "top":0, "left":0, "right":0, "bottom":0,
                    "border": (isCleanView()) ? "none" : (props.isSelected
                        ? "1px dashed #ffffff"
                        : "1px dashed #808080"),
                    "pointer-events": "none",
                    "z-index": 20
                }} />
            </Show>

            <Show when={props.unit.type === "sticker"}>
                <div
                    class="sticker-annotation-layer-viewport absolute"
                    style={(() => {
                        const viewport = isMinified()
                            ? getMinifiedAnnotationViewport()
                            : {
                                  width: props.unit.w,
                                  height: props.unit.h,
                                  offsetX: 0,
                                  offsetY: 0,
                              };
                        return {
                            width: `${viewport.width}px`,
                            height: `${viewport.height}px`,
                            left: `-${viewport.offsetX}px`,
                            top: `-${viewport.offsetY}px`,
                        };
                    })()}
                >
                    <StickerAnnotationLayer
                        unitId={props.unit.id}
                        width={isMinified() ? getMinifiedAnnotationViewport().width : props.unit.w}
                        height={isMinified() ? getMinifiedAnnotationViewport().height : props.unit.h}
                        imageSrc={displaySrc()}
                    />
                </div>
            </Show>

        </div>

        <Show when={!isMinified() && !isCleanView()}>
            <Show when={props.unit.type === "sticker" && props.isSelected && activeStickerEditTargetId() === props.unit.id}>
                <StickerTopStrip
                    unitId={props.unit.id}
                    x={currentPos().x}
                    y={currentPos().y}
                    stickerWidth={props.unit.w}
                    stickerHeight={props.unit.h}
                />
            </Show>
            <Show when={showSelectionBorder()}>
                <div
                    class="selection-border"
                    style={{
                        inset: props.isSelected ? "-2px" : "-1px",
                        border: props.isSelected
                            ? "2px solid white"
                            : `1px solid rgba(255,255,255,${Math.max(0.2, getOpacity())})`,
                        "pointer-events": "none",
                    }}
                />
            </Show>
        </Show>

        {/* === INTERACTION LAYER (Floating panels, outside of cropped visual) === */}

        {/* Unit Params Panel (Handling Inputs, Outputs, Params, Header) */}
        <Show when={props.showParams}>
             <UnitParamsPanel
                 unit={props.unit}
                 params={props.params}
                 execConfig={props.execConfig}
                 capability={props.capability}
                 connectedLinks={props.connectedLinks}
                 resolveUnitImage={props.resolveUnitImage}
                 availableArts={props.availableArts}
                 onParamChange={props.onParamChange}
                 onLinkStart={props.onLinkStart}
                 onLinkDrop={props.onLinkDrop}
                 onLinkHover={props.onLinkHover}
                 onLinkMove={props.onLinkMove}
                 onAddNode={props.onAddNode}
             />
        </Show>

        {/* Unit Add Node Menu (Center Overlay) */}
        <UnitAddNodeMenu
             unit={props.unit}
             availableArts={props.availableArts}
             onAddNode={props.onAddNode}
             showActions={props.showActions}
             currentPos={currentPos()}
        />

    </div>
  );
};
