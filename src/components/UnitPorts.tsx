
import { Component, For, Show, createEffect, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { Unit } from "../types/unit";
import { ArtCapability } from "../services/protocol";
import { logger } from "../services/logger";
import { propertyType, UnitPropertyTypeIcon } from "./UnitPropertyTypeIcon";
import { createUnitPortGesture } from "./unitPortGesture";
import { requestUnitPropertyDisclosure } from "../store/unitPropertyDisclosure";
import { linkingState } from "../store/uiStore";
import "../styles/unit-tab-properties.css";
import {
  registerDragFollowerElement,
  unregisterDragFollowerElement,
} from "../services/dragFollowerRegistry";

interface UnitPortsProps {
  outlineOutset?: number;
  unit: Unit;
  capability?: ArtCapability;
  portsLayer?: HTMLElement;
  isCleanView: boolean;

  // Position props (to sync with drag)
  x: number;
  y: number;
  width: number;
  height: number;

  onLinkStart: (propId: string, startX: number, startY: number) => void;
  onLinkDrop: (propId: string) => void;
  onLinkMove?: (portId: string, e: MouseEvent) => void;
}

export const UnitPorts: Component<UnitPortsProps> = (props) => {
  const gesture = createUnitPortGesture();
  let wrapperRef: HTMLDivElement | undefined;
  let dragFollowerRegistration: { unitId: string; element: HTMLDivElement } | null = null;

  const syncDragFollowerRegistration = () => {
      const unitId = props.unit.id;
      const shouldRegister = !!props.portsLayer && !props.isCleanView;
      const element = shouldRegister ? wrapperRef : undefined;
      const registration = dragFollowerRegistration;

      if (registration && (registration.unitId !== unitId || registration.element !== element)) {
          unregisterDragFollowerElement(registration.unitId, registration.element);
          dragFollowerRegistration = null;
      }
      if (!element || dragFollowerRegistration) return;

      registerDragFollowerElement(unitId, element);
      dragFollowerRegistration = { unitId, element };
  };

  createEffect(syncDragFollowerRegistration);
  onCleanup(() => {
      const registration = dragFollowerRegistration;
      if (registration) {
          unregisterDragFollowerElement(registration.unitId, registration.element);
          dragFollowerRegistration = null;
      }
  });

  const isArt = () => props.unit.type === 'art';
  const isMinified = () => !!props.unit.data.minified;

  // === PORT LOGIC ===
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

  // === VISIBILITY HELPERS ===
  const isPortVisible = (portName: string) => {
      // 1. User Override (Highest Priority)
      const userVis = props.unit.data.portVisibility?.[portName];
      if (typeof userVis === 'boolean') return userVis;

      // 2. Default Visibility (from backend capability)
      // Check if capability specifically defines default visibility
      const cap = props.capability;
      if (cap?.defaultVisibility && typeof cap.defaultVisibility[portName] === 'boolean') {
          return cap.defaultVisibility[portName];
      }

      // 3. Fallback: Default to Visible
      return true;
  };

  const getVisibleInputs = () => getInputs().filter(p => isPortVisible(p.name));
  const getVisibleOutputs = () => getOutputs().filter(p => isPortVisible(p.name));

  return (
        <Show when={props.portsLayer && !props.isCleanView}>
            <Portal mount={props.portsLayer!}>

                    <div
                        ref={(element) => {
                            wrapperRef = element;
                            syncDragFollowerRegistration();
                        }}
                        class="absolute pointer-events-none" // Wrapper follows unit, non-interactive itself
                        data-otter-drag-follow-unit-id={props.unit.id}
                        style={{
                            left: `${props.x}px`,
                            top: `${props.y}px`,
                            // FIX: Wrapper MUST match the visible container size (e.g. 60x60)
                            width: `${props.width}px`,
                            height: `${props.height}px`, // FIX: Explicit height to prevent "auto" collapse
                            "pointer-events": "none" // Allow clicking through the wrapper (but not ports)
                        }}
                    >
                    {/* === LEFT INPUT PORTS (Dots) === */}
                    <div
                        class={`absolute top-0 bottom-0 pointer-events-auto flex flex-col justify-start gap-3`}
                        style={{
                            left: isMinified() ? "-8px" : `${-12 - (props.outlineOutset ?? 1)}px`,
                            "padding-top": isMinified() ? "0" : "24px" ,
                            width: "24px", // Always allocate width
                            height: "100%",
                        }}
                    >
                        <For each={getVisibleInputs()}>
                            {(port, i) => (
                                <div
                                    class="unit-property-node-port cursor-pointer relative"
                                    data-port-name={port.name}
                                    data-node-port="true"
                                    style={{
                                        "clip-path": isMinified() ? undefined : "inset(0 50% 0 0)",
                                        "width": isMinified() ? "8px" : "24px",
                                        "height": isMinified() ? "8px" : "24px",
                                        "flex-shrink": 0, // Prevent squashing
                                        "position": isMinified() ? "absolute" : "relative",
                                        // Vertical Centering for Minified
                                        ...(isMinified() ? {
                                            "top": `calc(${((i() + 0.5) / getInputs().length) * 100}% - 4px)`
                                        } : {})
                                    }}
                                    onMouseDown={(e) => gesture(e, {
                                        click: () => requestUnitPropertyDisclosure(props.unit.id, port.name, "input"),
                                        drag: (_center, move) => props.onLinkMove?.(port.name, move),
                                    })}
                                    onMouseUp={(e) => {
                                        e.stopPropagation();
                                        // Explicitly notify parent to complete the link
                                        logger.debug("UnitView: Input Port MouseUp -> onLinkDrop", port.name);
                                        if (linkingState().isLinking) props.onLinkDrop(port.name);
                                    }}
                                ><UnitPropertyTypeIcon type={propertyType(port.type)} /></div>
                            )}
                        </For>
                    </div>

                    {/* === RIGHT OUTPUT PORTS (Dots) === */}
                    <div
                        class={`absolute top-0 bottom-0 pointer-events-auto flex flex-col justify-start items-end gap-3`}
                        style={{
                            right: isMinified() ? "-8px" : `${-12 - (props.outlineOutset ?? 1)}px`,
                            "padding-top": isMinified() ? "0" : "24px",
                            width: "24px",
                            height: "100%"
                        }}
                    >
                        <For each={getVisibleOutputs()}>
                            {(port, i) => (
                                <div
                                    class="unit-property-node-port cursor-cell relative"
                                    data-port-name={port.name}
                                    data-node-port="true"
                                    title={port.label || "Output"}
                                    style={{
                                        "clip-path": isMinified() ? undefined : "inset(0 0 0 50%)",
                                        "width": isMinified() ? "8px" : "24px",
                                        "height": isMinified() ? "8px" : "24px",
                                        "flex-shrink": 0, // Prevent squashing
                                        "position": isMinified() ? "absolute" : "relative",
                                        ...(isMinified() ? {
                                            "top": `calc(${((i() + 0.5) / getOutputs().length) * 100}% - 4px)`
                                        } : {})
                                    }}
                                    onMouseDown={(e) => gesture(e, {
                                        click: () => requestUnitPropertyDisclosure(props.unit.id, port.name, "output"),
                                        drag: (center) => props.onLinkStart(port.name, center.x, center.y),
                                    })}
                                ><UnitPropertyTypeIcon type={propertyType(port.type)} /></div>
                            )}
                        </For>
                    </div>
                </div>
            </Portal>
        </Show>
  );
};
