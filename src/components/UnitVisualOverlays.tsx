import { Component, For, Show } from "solid-js";
import { enhancementNotices, uiActions } from "../store/uiStore";
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
    minifiedBakedPreviewSrc?: string;
    minifiedAnnotationViewport: ImageViewport;
    displaySrc: string;
    artErrorMessage: string;
}

export const resolveOcrImageFrame = (unit: Unit, minified: boolean) => {
    const ocr = unit.data.ocrResult;
    const imageWidth = ocr?.width;
    const imageHeight = ocr?.height;
    if (
        typeof imageWidth !== "number" ||
        typeof imageHeight !== "number" ||
        !Number.isFinite(imageWidth) ||
        !Number.isFinite(imageHeight) ||
        !Number.isFinite(unit.w) ||
        !Number.isFinite(unit.h) ||
        imageWidth <= 0 ||
        imageHeight <= 0 ||
        unit.w <= 0 ||
        unit.h <= 0
    ) return null;
    if (minified) {
        return {
            left: 0,
            top: 0,
            width: unit.w,
            height: unit.h,
            scaleX: unit.w / imageWidth,
            scaleY: unit.h / imageHeight,
        };
    }
    const scale = Math.min(unit.w / imageWidth, unit.h / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return {
        left: (unit.w - width) / 2,
        top: (unit.h - height) / 2,
        width,
        height,
        scaleX: scale,
        scaleY: scale,
    };
};

export const resolveOcrBlockBounds = (boxPoints: { x: number; y: number }[] | undefined) => {
    if (
        !Array.isArray(boxPoints) ||
        boxPoints.length === 0 ||
        boxPoints.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y))
    ) return null;
    const xs = boxPoints.map((point) => point.x);
    const ys = boxPoints.map((point) => point.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
    };
};

const OCR_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

/** Keeps malformed OCR payload values out of inline style declarations. */
export const resolveOcrOverlayColor = (value: unknown, fallback: string) =>
    typeof value === "string" && OCR_COLOR.test(value) ? value : fallback;

/** Renders status, OCR, notice, crop, and editable annotation overlays in z-order. */
export const UnitVisualOverlays: Component<UnitVisualOverlaysProps> = (props) => (
    <>
        <Show when={props.isArt && props.unit.data.nodeStatus === "error"}>
            <div
                class="hook-art-error-overlay pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-center"
                style={{ "z-index": 30 }}
            >
                <div style={{ "max-height": "70%", overflow: "hidden" }}>
                    <div class="hook-art-error-overlay__title text-xs font-semibold">执行失败</div>
                    <div class="mt-1 text-[11px] leading-snug break-words">{props.artErrorMessage}</div>
                </div>
            </div>
        </Show>

        <Show when={!props.isMinified && props.unit.data.ocrResult?.textBlocks?.length}>
            <div class="absolute inset-0 pointer-events-none" style={{ "z-index": 15 }}>
                <For each={props.unit.data.ocrResult?.textBlocks || []}>{(block) => {
                    const frame = resolveOcrImageFrame(props.unit, props.isMinified);
                    if (!frame) return null;
                    const bounds = resolveOcrBlockBounds(block.boxPoints);
                    if (!bounds) return null;
                    const label = props.unit.data.showTranslated && block.translatedText
                        ? block.translatedText
                        : block.text;
                    const foregroundColor = resolveOcrOverlayColor(block.colorHex, "#ffffff");
                    const backgroundColor = resolveOcrOverlayColor(block.bgColorHex, "#000000").slice(0, 7);
                    return (
                        <div
                            class="absolute rounded-sm border border-white/40 shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
                            style={{
                                left: `${frame.left + bounds.minX * frame.scaleX}px`,
                                top: `${frame.top + bounds.minY * frame.scaleY}px`,
                                width: `${Math.max((bounds.maxX - bounds.minX) * frame.scaleX, 18)}px`,
                                height: `${Math.max((bounds.maxY - bounds.minY) * frame.scaleY, 18)}px`,
                                color: foregroundColor,
                                "background-color": `${backgroundColor}40`,
                            }}
                        >
                            <div
                                class="absolute left-0 top-0 max-w-full truncate px-1 py-[1px] text-[10px] font-medium leading-tight"
                                style={{ color: foregroundColor, "background-color": `${backgroundColor}cc` }}
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
                    class="enhancement-notice hook-enhancement-notice absolute left-2 right-2 top-2 p-3 text-left"
                    style={{ "z-index": 40, "pointer-events": "auto" }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onMouseUp={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDblClick={(event) => event.stopPropagation()}
                >
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="hook-enhancement-notice__title text-[11px] font-semibold">{notice().title}</div>
                            <div class="hook-enhancement-notice__copy mt-1 text-[10px] leading-snug">{notice().message}</div>
                        </div>
                        <button
                            class="hook-terminal-btn shrink-0 px-2 py-1 text-[10px]"
                            onMouseDown={(event) => event.stopPropagation()}
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
                    display: props.minifiedBakedPreviewSrc ? "none" : "block",
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

interface UnitSelectionBorderProps {
    isSelected: boolean;
    opacity: number;
}

export const UnitSelectionBorder: Component<UnitSelectionBorderProps> = (props) => (
    <div
        class="selection-border"
        style={{
            inset: props.isSelected ? "-2px" : "-1px",
            border: props.isSelected
                ? "2px solid white"
                : `1px solid rgba(255,255,255,${Math.max(0.2, props.opacity)})`,
            "pointer-events": "none",
        }}
    />
);
