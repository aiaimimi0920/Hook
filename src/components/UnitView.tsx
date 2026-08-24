import { Component, Show, Suspense, createEffect, createSignal, lazy, onCleanup } from "solid-js";
import {
  activeStickerEditTargetId,
  isCleanView,
  isSelecting,
  longCaptureSession,
  selectionActions,
  selectedStickerAnnotationId,
  selectedStickerAnnotationIds,
  stickerToolSettings,
} from "../store/uiStore";
import { Unit, Link, NodeExecutionConfig } from "../types/unit";
import { ArtCapability } from "../services/protocol";
import { computeStickerWheelResizeFrame } from "../services/stickerEditing";
import { UnitAddNodeMenu } from "./UnitAddNodeMenu";
import { UnitPorts } from "./UnitPorts";
import { isStickerSurfaceDoubleClickTarget } from "../services/stickerDoubleClick";
import { api } from "../services/api";
import { stickerContextMenuController } from "../services/stickerContextMenuController";
import { ShortcutManager } from "../services/shortcuts";
import {
  enterStickerGpuWarmHover,
  leaveStickerGpuWarmHover,
  registerStickerGpuWarmElement,
  setStickerGpuWarmSelected,
  unregisterStickerGpuWarmElement,
  updateStickerGpuWarmEstimate,
} from "../services/stickerGpuWarmPool";
import {
  registerDragFollowerElement,
  unregisterDragFollowerElement,
} from "../services/dragFollowerRegistry";
import { blurActiveEditableOutside } from "../services/editableFocus";
import { UnitNativeStickerDragPreview } from "./UnitNativeStickerDragPreview";
import { createUnitNativeStickerDragController } from "./unitNativeStickerDragController";
import { UnitStickerImageContent } from "./UnitStickerImageContent";
import { UnitSurfaceContent } from "./UnitSurfaceContent";
import { UnitSelectionBorder, UnitVisualOverlays } from "./UnitVisualOverlays";
import { createUnitPortRegistryController } from "./unitPortRegistryController";
import { createUnitImageModel } from "./unitImageModel";
import { createUnitSurfaceController } from "./unitSurfaceController";

// Editing panels are not needed for the normal canvas path. Their component
// lifetimes were already conditional, so lazy loading preserves mount semantics.
const StickerTopStrip = lazy(() => import("./StickerTopStrip").then((module) => ({
  default: module.StickerTopStrip,
})));
const UnitParamsPanel = lazy(() => import("./UnitParamsPanel").then((module) => ({
  default: module.UnitParamsPanel,
})));

interface Props {
  unit: Unit;
  params: Record<string, any>; // Direct Store reference for reactivity
  // Separate store for execution config (avoids re-render flickering)
  execConfig?: NodeExecutionConfig;
  capability?: ArtCapability; // Metadata for Art nodes
  isSelected: boolean;
  showActions: boolean;
  showParams: boolean; // NEW: Toggle state for params
  onMouseDown: (e: MouseEvent) => void;
  onParamChange: (propId: string, value: any, isFinal?: boolean) => void;
  onDoubleTap: (e: MouseEvent) => void;
  onDelete: () => void;
  onCloseActions?: () => void;
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

  connectedPorts?: string[]; // List of connected INPUT ports
  connectedLinks?: Link[]; // NEW: Full Links for resolving upstream units
  portsLayer?: HTMLElement; // NEW: Global Layer for Z-independent ports
}

export const UnitView: Component<Props> = (props) => {
  let unitContainerRef: HTMLDivElement | undefined;
  const [unitElement, setUnitElement] = createSignal<HTMLDivElement>();
  let gpuWarmRegistration: { unitId: string; element: HTMLDivElement } | null = null;
  let dragFollowerRegistration: { unitId: string; element: HTMLDivElement } | null = null;
  let pendingWheelDeltaY = 0;
  let pendingWheelPointer: { x: number; y: number } | null = null;
  let wheelResizeFrame: number | null = null;
  const isArt = () => props.unit.type === 'art';
  const liveUnit = () => props.unit;
  const syncStickerGpuWarmRegistration = () => {
      const unit = liveUnit();
      const element = unitContainerRef;
      const registration = gpuWarmRegistration;

      if (
          registration &&
          (registration.unitId !== unit.id || registration.element !== element || unit.type !== "sticker")
      ) {
          unregisterStickerGpuWarmElement(registration.unitId, registration.element);
          gpuWarmRegistration = null;
      }
      if (!element || unit.type !== "sticker") return;

      const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
      if (!gpuWarmRegistration) {
          registerStickerGpuWarmElement(unit.id, element, unit.w, unit.h, devicePixelRatio);
          gpuWarmRegistration = { unitId: unit.id, element };
      } else {
          updateStickerGpuWarmEstimate(unit.id, unit.w, unit.h, devicePixelRatio);
      }
      setStickerGpuWarmSelected(unit.id, props.isSelected);
  };
  const syncDragFollowerRegistration = () => {
      const unitId = liveUnit().id;
      const element = unitContainerRef;
      const registration = dragFollowerRegistration;

      if (registration && (registration.unitId !== unitId || registration.element !== element)) {
          unregisterDragFollowerElement(registration.unitId, registration.element);
          dragFollowerRegistration = null;
      }
      if (!element || dragFollowerRegistration) return;

      registerDragFollowerElement(unitId, element);
      dragFollowerRegistration = { unitId, element };
  };
  const flushPendingWheelResize = () => {
      wheelResizeFrame = null;
      const deltaY = pendingWheelDeltaY;
      const pointer = pendingWheelPointer;
      pendingWheelDeltaY = 0;
      pendingWheelPointer = null;
      if (!pointer || deltaY === 0 || isMinified()) return;

      const currentUnit = liveUnit();
      props.onResize(computeStickerWheelResizeFrame(currentUnit, pointer, deltaY));
  };
  const queueWheelResize = (event: WheelEvent) => {
      pendingWheelDeltaY += event.deltaY;
      pendingWheelPointer = { x: event.clientX, y: event.clientY };
      if (wheelResizeFrame === null) {
          wheelResizeFrame = window.requestAnimationFrame(flushPendingWheelResize);
      }
  };
  const isMinified = () => !!liveUnit().data.minified;
  const hasSelectedExistingAnnotations = () =>
      selectedStickerAnnotationIds.length > 0 || selectedStickerAnnotationId() !== null;
  const shouldBlockContainerMouseDown = () => {
      if (activeStickerEditTargetId() !== props.unit.id) return false;
      if (props.unit.type !== "sticker" && props.unit.type !== "art") return false;
      if (stickerToolSettings.domain !== "existing") {
          if (stickerToolSettings.domain === "create") return true;
          return stickerToolSettings.activeCanvasTool !== "idle";
      }
      if (stickerToolSettings.transformMode !== "select") return true;
      return hasSelectedExistingAnnotations();
  };
  const allowContainerMouseDown = () => !shouldBlockContainerMouseDown();
  const activateUnit = () => {
      blurActiveEditableOutside(unitContainerRef, props.unit.id);
      if (!selectionActions.isSelected(props.unit.id)) {
          selectionActions.set([props.unit.id]);
      }
      return api.focusOverlayWindow();
  };
  const handleUnitDoubleClick = (event: MouseEvent) => {
      if (props.unit.type === "sticker" && !isStickerSurfaceDoubleClickTarget(event.target, event.currentTarget)) {
          event.stopPropagation();
          return;
      }
      props.onDoubleTap(event);
  };
  const showSelectionBorder = () => true;
  const surface = createUnitSurfaceController({
      unit: liveUnit,
      capability: () => props.capability,
      params: () => props.params,
      resolveUnitImage: () => props.resolveUnitImage,
      onResize: (nextFrame) => props.onResize(nextFrame),
  });

  const style = () => {
    const unit = liveUnit();

    return {
        left: `${unit.x}px`,
        top: `${unit.y}px`,
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

  createEffect(syncStickerGpuWarmRegistration);
  createEffect(syncDragFollowerRegistration);

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

  const image = createUnitImageModel({
      unit: liveUnit,
      params: () => props.params,
      connectedLinks: () => props.connectedLinks,
      resolveUnitImage: () => props.resolveUnitImage,
      inputs: getInputs,
      isShaderArt: surface.isShaderArt,
      artId: surface.artId,
      shaderInputSrc: surface.shaderInputSrc,
      shaderReferenceSrc: surface.shaderReferenceSrc,
  });

  const nativeStickerDrag = createUnitNativeStickerDragController({
      unit: liveUnit,
      capabilityLabel: () => props.capability?.label,
      displaySrc: image.baseImageSrc,
      element: unitElement,
  });
  createUnitPortRegistryController({
      unit: liveUnit,
      inputs: getInputs,
      outputs: getOutputs,
      element: unitElement,
  });

  onCleanup(() => {
      const registration = gpuWarmRegistration;
      if (registration) {
          unregisterStickerGpuWarmElement(registration.unitId, registration.element);
          gpuWarmRegistration = null;
      }
      const followerRegistration = dragFollowerRegistration;
      if (followerRegistration) {
          unregisterDragFollowerElement(followerRegistration.unitId, followerRegistration.element);
          dragFollowerRegistration = null;
      }
      if (wheelResizeFrame !== null) {
          window.cancelAnimationFrame(wheelResizeFrame);
          wheelResizeFrame = null;
      }
  });

  return (
    <div
      class={`unit-container ${props.isSelected ? "selected" : ""} ${isArt() ? "art-node" : "sticker-node"} ${isMinified() ? "minified" : ""}`}
      style={style()}

      ref={(element) => {
        unitContainerRef = element;
        setUnitElement(element);
        syncStickerGpuWarmRegistration();
        syncDragFollowerRegistration();
      }}

      data-unit-id={props.unit.id} // NEW: For global hit-testing (Link Node)
      data-hook-drag-follow-unit-id={props.unit.id}
      tabIndex={-1}
      onPointerEnter={() => enterStickerGpuWarmHover(props.unit.id)}
      onPointerLeave={() => leaveStickerGpuWarmHover(props.unit.id)}
      onMouseDown={(event) => {
        blurActiveEditableOutside(unitContainerRef, props.unit.id);
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
        if (ShortcutManager.isGestureActive(e, 'sticker_resize')) {
            e.preventDefault();
            e.stopPropagation();
            if (isMinified()) return;
            queueWheelResize(e);
        } else if (ShortcutManager.isGestureActive(e, 'sticker_opacity')) {
            e.preventDefault();
            e.stopPropagation();

            const currentUnit = liveUnit();
            const currentOp = currentUnit.data.minified
                ? (currentUnit.data.opacityMini ?? 0.9)
                : (currentUnit.data.opacityNormal ?? 1.0);

            // Step 0.05 per scroll click
            const delta = -e.deltaY * 0.001;
            const newOp = Math.max(0, Math.min(1, currentOp + delta));

            props.onOpacityChange(newOp);
        }
      }}
    >
        <UnitNativeStickerDragPreview preview={nativeStickerDrag.preview()} />
        <UnitPorts
            unit={props.unit}
            capability={props.capability}
            portsLayer={props.portsLayer}
            isCleanView={isCleanView()}

            x={props.unit.x}
            y={props.unit.y}
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
            "border-radius": `${image.cornerRadius()}px`,
            "border": "none",
            "box-sizing": "border-box",
            "background": "transparent",
            "opacity": image.opacity(),
            "z-index": "1" // Ensure it covers the tucked-under ports
        }}>
            <UnitSurfaceContent
                unit={props.unit}
                unitElement={unitElement()}
                surface={surface.surfaceState()}
                effectiveSurfaceSnapshot={surface.effectiveSurfaceSnapshot()}
                surfacePresentation={surface.surfacePresentation()}
                isMinified={isMinified()}
                isShaderArt={surface.isShaderArt()}
                artId={surface.artId()}
                minifiedViewport={image.minifiedViewport()}
                effectiveParams={surface.effectiveParams()}
                holdFallbackPreview={surface.holdRestoredShaderPreview()}
                inputImageSrc={surface.shaderInputSrc()}
                referenceImageSrc={surface.shaderReferenceSrc()}
                requiresReference={surface.requiresReference()}
                resolveUnitImage={props.resolveUnitImage}
                allowContainerMouseDown={allowContainerMouseDown()}
                onActivate={activateUnit}
                onMouseDown={props.onMouseDown}
                onIntrinsicSizeChange={image.setShaderImageIntrinsicSize}
                onRendered={(dataUrl) => props.onRendered(props.unit.id, dataUrl)}
            />
            <UnitStickerImageContent
                unit={props.unit}
                hasDeclarativeSurface={surface.hasDeclarativeSurface()}
                isShaderArt={surface.isShaderArt()}
                isMinified={isMinified()}
                minifiedBakedPreviewSrc={image.minifiedBakedPreviewSrc()}
                minifiedAnnotationViewport={image.minifiedAnnotationViewport()}
                imageContentFrame={image.imageContentFrame()}
                minifiedViewport={image.minifiedViewport()}
                croppedImageViewport={image.croppedImageViewport()}
                transform={image.transform()}
                baseImageSrc={image.baseImageSrc()}
                browserDragEnabled={nativeStickerDrag.browserDragEnabled()}
                onBrowserDragStart={nativeStickerDrag.handleBrowserImageDragStart}
                onBaseImageLoad={image.handleBaseImageLoad}
                onImageError={image.handleFileBackedImageLoadError}
                imageBorderWidth={image.imageBorderWidth()}
                imageBorderColor={image.imageBorderColor()}
                cornerRadius={image.cornerRadius()}
            />
            <UnitVisualOverlays
                unit={props.unit}
                isArt={isArt()}
                isMinified={isMinified()}
                isSelected={props.isSelected}
                isCleanView={isCleanView()}
                minifiedBakedPreviewSrc={image.minifiedBakedPreviewSrc()}
                minifiedAnnotationViewport={image.minifiedAnnotationViewport()}
                displaySrc={image.displaySrc()}
                artErrorMessage={surface.artErrorMessage()}
            />

        </div>

        <Show when={!isMinified() && !isCleanView()}>
            <Show when={props.isSelected && activeStickerEditTargetId() === props.unit.id}>
                <Suspense>
                    <StickerTopStrip
                        unitId={props.unit.id}
                        x={props.unit.x}
                        y={props.unit.y}
                        stickerWidth={props.unit.w}
                        stickerHeight={props.unit.h}
                        supportsBitmapTools={props.unit.type === "sticker"}
                        isArt={props.unit.type === "art"}
                        surfaceViews={surface.surfaceViews()}
                        selectedSurfaceViewId={surface.selectedSurfaceView()?.id}
                        onSurfaceViewChange={surface.selectSurfaceView}
                    />
                </Suspense>
            </Show>
            <Show when={showSelectionBorder()}>
                <UnitSelectionBorder isSelected={props.isSelected} opacity={image.opacity()} />
            </Show>
        </Show>

        {/* === INTERACTION LAYER (Floating panels, outside of cropped visual) === */}

        {/* Unit Params Panel (Handling Inputs, Outputs, Params, Header) */}
        <Show when={props.showParams}>
             <Suspense>
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
             </Suspense>
        </Show>

        {/* Unit Add Node Menu (Center Overlay) */}
        <UnitAddNodeMenu
             unit={props.unit}
             availableArts={props.availableArts}
             onAddNode={props.onAddNode}
             onClose={props.onCloseActions}
             showActions={props.showActions}
             currentPos={{ x: props.unit.x, y: props.unit.y }}
        />

    </div>
  );
};
