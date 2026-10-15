import { Component, Show } from "solid-js";
import type { Unit } from "../types/unit";
import { StickerAnnotationLayer } from "./StickerAnnotationLayer";

interface ImageViewport {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
}

interface UnitVisualOverlaysProps {
    unit: Unit;
    isArt: boolean;
    isMinified: boolean;
    isSelected: boolean;
    isCleanView: boolean;
    minifiedAnnotationViewport: ImageViewport;
    displaySrc: string;
    artErrorMessage: string;
}

/** Renders core status, crop, and editable annotation overlays in z-order. */
export const UnitVisualOverlays: Component<UnitVisualOverlaysProps> = (props) => {
    return (
    <>
        <Show when={props.isArt && props.unit.data.nodeStatus === "error"}>
            <div
                class="otter-art-error-overlay pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center"
                style={{ "z-index": 30 }}
            >
                <div style={{ "max-height": "70%", overflow: "hidden" }}>
                    <div class="otter-art-error-overlay__title text-xs font-semibold">执行失败</div>
                    <div class="mt-1 text-[11px] leading-snug break-words">{props.artErrorMessage}</div>
                </div>
            </div>
        </Show>

        <Show when={props.isMinified}>
            <div
                class="mini-overlay"
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    border: props.isCleanView ? "none" : props.isSelected ? "1px dashed #ffffff" : "1px dashed #808080",
                    "pointer-events": "none",
                    "z-index": 20,
                }}
            />
        </Show>

        <Show when={props.unit.type === "sticker" || props.unit.type === "art"}>
            <div
                class="sticker-annotation-layer-viewport absolute"
                style={{
                    width: `${props.isMinified ? props.minifiedAnnotationViewport.width : props.unit.w}px`,
                    height: `${props.isMinified ? props.minifiedAnnotationViewport.height : props.unit.h}px`,
                    left: `${props.isMinified ? -props.minifiedAnnotationViewport.offsetX : 0}px`,
                    top: `${props.isMinified ? -props.minifiedAnnotationViewport.offsetY : 0}px`,
                    "pointer-events": "none",
                }}
            >
                <StickerAnnotationLayer
                    unitId={props.unit.id}
                    width={props.isMinified ? props.minifiedAnnotationViewport.width : props.unit.w}
                    height={props.isMinified ? props.minifiedAnnotationViewport.height : props.unit.h}
                    imageSrc={props.displaySrc}
                />
            </div>
        </Show>
    </>
    );
};

export { UnitSelectionBorder } from "./UnitSelectionBorder";
