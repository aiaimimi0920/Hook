import { Component, JSX, Show } from "solid-js";
import type { Unit } from "../types/unit";
import { liveCaptureViews } from "../store/liveCaptureStore";
import { activeStickerEditTargetId } from "../store/uiStore";
import { registerLiveGpuPreview } from "../services/liveGpuPreview";

interface ImageViewport {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
}

interface ImageContentFrame {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface UnitStickerImageContentProps {
    unit: Unit;
    hasDeclarativeSurface: boolean;
    isShaderArt: boolean;
    isMinified: boolean;
    minifiedAnnotationViewport: ImageViewport;
    imageContentFrame: ImageContentFrame;
    minifiedViewport: ImageViewport;
    croppedImageViewport: ImageViewport | null;
    transform: string;
    baseImageSrc: string;
    browserDragEnabled: boolean;
    onBrowserDragStart: (event: DragEvent) => void;
    onBaseImageLoad: (event: Event) => void;
    onImageError: () => void;
    imageBorderWidth: number;
    imageBorderColor: string;
    cornerRadius: number;
}

const imageStyle = (
    isMinified: boolean,
    minifiedViewport: ImageViewport,
    croppedImageViewport: ImageViewport | null,
    transform: string,
): JSX.CSSProperties => {
    if (isMinified) {
        return {
            position: "absolute",
            width: `${minifiedViewport.width}px`,
            height: `${minifiedViewport.height}px`,
            "min-width": `${minifiedViewport.width}px`,
            "min-height": `${minifiedViewport.height}px`,
            "max-width": "none",
            "max-height": "none",
            left: `${-minifiedViewport.offsetX}px`,
            top: `${-minifiedViewport.offsetY}px`,
            "pointer-events": "auto",
            "object-fit": "fill",
            transform,
        };
    }
    if (croppedImageViewport) {
        const viewport = croppedImageViewport;
        return {
            position: "absolute",
            width: `${viewport.width}px`,
            height: `${viewport.height}px`,
            left: `-${viewport.offsetX}px`,
            top: `-${viewport.offsetY}px`,
            "min-width": `${viewport.width}px`,
            "min-height": `${viewport.height}px`,
            "max-width": "none",
            "max-height": "none",
            "pointer-events": "auto",
            "object-fit": "contain",
            transform,
        };
    }
    return {
        width: "100%",
        height: "100%",
        "object-fit": "contain",
        "max-width": "100%",
        "max-height": "100%",
        "pointer-events": "auto",
        transform,
    };
};

/** Keeps live image layers mounted; minification only clips their full-size frame. */
export const UnitStickerImageContent: Component<UnitStickerImageContentProps> = (props) => {
    const liveGpuUnitId = () => props.unit.id;
    const liveGpuDisabled = () => props.isMinified || Boolean(props.croppedImageViewport)
        || props.cornerRadius > 0 || Boolean(props.unit.data.rasterizedAnnotationLayerSrc);
    return (
    <>
        <Show when={!props.hasDeclarativeSurface && !props.isShaderArt}>
            <div
                class="sticker-image-content-frame"
                style={{
                    position: "absolute",
                    left: `${props.imageContentFrame.x}px`,
                    top: `${props.imageContentFrame.y}px`,
                    width: `${props.imageContentFrame.w}px`,
                    height: `${props.imageContentFrame.h}px`,
                    overflow: "hidden",
                    "pointer-events": "auto",
                }}
            >
                <img
                    class="sticker-img"
                    ref={(image) => registerLiveGpuPreview(image, liveGpuUnitId, liveGpuDisabled)}
                    data-sticker-base-image="true"
                    draggable={props.browserDragEnabled}
                    onDragStart={(event) => props.onBrowserDragStart(event)}
                    src={activeStickerEditTargetId() === props.unit.id
                        ? props.baseImageSrc
                        : liveCaptureViews.find((view) => view.sessionId === props.unit.id)?.imageUrl || props.baseImageSrc}
                    onLoad={(event) => props.onBaseImageLoad(event)}
                    onError={() => props.onImageError()}
                    style={imageStyle(
                        props.isMinified && props.unit.type !== "sticker",
                        props.minifiedViewport,
                        props.croppedImageViewport,
                        props.transform,
                    )}
                />
            </div>
        </Show>

        <Show when={!props.isShaderArt && props.unit.data.rasterizedAnnotationLayerSrc}>
            {(layerSrc) => (
                <div
                    class="sticker-rasterized-annotation-layer-viewport absolute"
                    style={{
                        width: `${props.isMinified ? props.minifiedAnnotationViewport.width : props.unit.w}px`,
                        height: `${props.isMinified ? props.minifiedAnnotationViewport.height : props.unit.h}px`,
                        left: `${props.isMinified ? -props.minifiedAnnotationViewport.offsetX : 0}px`,
                        top: `${props.isMinified ? -props.minifiedAnnotationViewport.offsetY : 0}px`,
                        "pointer-events": "none",
                        "z-index": 11,
                    }}
                >
                    <img
                        class="sticker-rasterized-annotation-layer pointer-events-none absolute inset-0"
                        src={layerSrc()}
                        draggable={false}
                        style={{ width: "100%", height: "100%", "object-fit": "fill", "max-width": "100%", "max-height": "100%" }}
                    />
                </div>
            )}
        </Show>

        <Show when={props.imageBorderWidth > 0}>
            <div
                class="pointer-events-none absolute inset-0 z-[12] box-border"
                style={{
                    border: `${props.imageBorderWidth}px solid ${props.imageBorderColor}`,
                    "border-radius": `${props.cornerRadius}px`,
                }}
            />
        </Show>
    </>
    );
};
