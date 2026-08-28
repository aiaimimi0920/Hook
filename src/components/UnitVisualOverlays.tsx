import { Component, For, Show, createEffect, createMemo, onCleanup } from "solid-js";
import { ocrInteractiveUnitId } from "../store/uiStore";
import type { Unit } from "../types/unit";
import {
    resolveOcrBlockPresentation,
    resolveOcrImageFrame,
    resolveOcrOverlayBlocks,
    resolveOcrOverlayVisualLines,
} from "../services/ocrOverlayLayout";
import {
    disposeOcrOverlayRects,
    syncOcrOverlayRects,
} from "../services/ocrOverlayInteraction";
import { copyOcrTextWithNotice } from "../services/ocrCopyNotice";
import { resolveOcrBaselineTextPlacement } from "../services/ocrOverlayBaseline";
import {
    resolveOcrOverlayFontFamily,
    resolveOcrTextTypography,
} from "../services/ocrOverlayTypography";
import { resolveOcrOverlayFillColor } from "../services/ocrOverlayFillColor";
import { StickerAnnotationLayer } from "./StickerAnnotationLayer";
import { BarcodeVisualOverlay } from "./BarcodeVisualOverlay";

export {
    clipOcrBoundsToFrame,
    resolveOcrBlockBounds,
    resolveOcrBlockPresentation,
    resolveOcrImageFrame,
    resolveOcrOverlayBlocks,
} from "../services/ocrOverlayLayout";

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

const OCR_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

/** Keeps malformed OCR payload values out of inline style declarations. */
export const resolveOcrOverlayColor = (value: unknown, fallback: string) =>
    typeof value === "string" && OCR_COLOR.test(value) ? value : fallback;

const parseRgbHex = (value: string) => {
    const match = /^#([0-9a-f]{6})$/i.exec(value.slice(0, 7));
    if (!match) return null;
    return [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
};

const relativeLuminance = (rgb: readonly number[]) => rgb.reduce((sum, channel, index) => {
    const value = channel / 255;
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
}, 0);

const contrastRatio = (left: readonly number[], right: readonly number[]) => {
    const leftLuminance = relativeLuminance(left);
    const rightLuminance = relativeLuminance(right);
    return (Math.max(leftLuminance, rightLuminance) + 0.05)
        / (Math.min(leftLuminance, rightLuminance) + 0.05);
};

/** Preserves the OCR text color when readable, otherwise uses the safer neutral. */
export const resolveReadableOcrColor = (foreground: string, background: string) => {
    const foregroundRgb = parseRgbHex(foreground);
    const backgroundRgb = parseRgbHex(background);
    if (!foregroundRgb || !backgroundRgb) return foreground;
    if (contrastRatio(foregroundRgb, backgroundRgb) >= 4.5) return foreground;
    const blackContrast = contrastRatio([0, 0, 0], backgroundRgb);
    const whiteContrast = contrastRatio([255, 255, 255], backgroundRgb);
    return whiteContrast >= blackContrast ? "#ffffff" : "#000000";
};

/** Renders status, OCR, crop, and editable annotation overlays in z-order. */
export const UnitVisualOverlays: Component<UnitVisualOverlaysProps> = (props) => {
    let registeredOcrRectIds: string[] = [];
    const ocrOverlayBlocks = createMemo(() => {
        const showTranslated = props.unit.data.showTranslated;
        return resolveOcrOverlayBlocks(
            props.unit.data.ocrResult?.textBlocks,
            props.unit.data.ocrResult?.scaleFactor,
            (block) => showTranslated && block.translatedText
                ? block.translatedText
                : block.text,
        );
    });
    const ocrOverlayFillColor = createMemo(() => resolveOcrOverlayFillColor(ocrOverlayBlocks()));
    const ocrOverlayFontFamily = createMemo(() => {
        const blocks = ocrOverlayBlocks();
        const frame = resolveOcrImageFrame(props.unit, props.isMinified);
        const geometrySamples = frame
            ? blocks.flatMap((block) => resolveOcrOverlayVisualLines(block).map((line) => {
                const lineCount = Math.max(1, line.text.split(/\r\n|\r|\n/).length);
                const presentation = resolveOcrBlockPresentation(
                    frame,
                    line.bounds,
                    lineCount,
                    line.lineHeightHint,
                );
                return {
                    text: line.text,
                    width: presentation.width,
                    paddingX: presentation.paddingX,
                    fontSize: presentation.fontSize,
                };
            }))
            : [];
        return resolveOcrOverlayFontFamily(
            blocks.map((block) => block.text),
            geometrySamples,
        );
    });

    const requestOcrCopy = (unitId: string, text: string) => {
        void copyOcrTextWithNotice(unitId, text);
    };

    createEffect(() => {
        const unit = props.unit;
        registeredOcrRectIds = syncOcrOverlayRects(
            registeredOcrRectIds,
            unit,
            resolveOcrImageFrame(unit, props.isMinified),
            !props.isMinified && ocrInteractiveUnitId() === unit.id && !unit.data.hideOcr,
            ocrOverlayBlocks(),
        );
    });

    onCleanup(() => {
        disposeOcrOverlayRects(registeredOcrRectIds);
    });

    return (
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

        <Show when={!props.isMinified && !props.unit.data.hideOcr && props.unit.data.ocrResult?.textBlocks?.length}>
            <Show when={resolveOcrImageFrame(props.unit, props.isMinified)} keyed>{(clipFrame) => (
                <div
                    class="hook-ocr-image-clip absolute pointer-events-none"
                    style={{
                        left: `${clipFrame.left}px`,
                        top: `${clipFrame.top}px`,
                        width: `${clipFrame.width}px`,
                        height: `${clipFrame.height}px`,
                        overflow: "hidden",
                    }}
                >
                    <div
                        class="absolute pointer-events-none"
                        style={{
                            left: `${-clipFrame.left}px`,
                            top: `${-clipFrame.top}px`,
                            width: `${props.unit.w}px`,
                            height: `${props.unit.h}px`,
                        }}
                    >
                        {/* Every OCR row in this sticker shares one opaque fill.
                            Keeping fills in their own layer prevents an overlapping
                            row from painting over another row's replacement glyphs. */}
                        <div class="absolute inset-0 pointer-events-none" style={{ "z-index": 15 }}>
                            <For each={ocrOverlayBlocks()}>{(block) => {
                                const frame = resolveOcrImageFrame(props.unit, props.isMinified);
                                if (!frame) return null;
                                return (
                                    <For each={resolveOcrOverlayVisualLines(block)}>{(line) => {
                                        const lineCount = Math.max(1, line.text.split(/\r\n|\r|\n/).length);
                                        const presentation = resolveOcrBlockPresentation(
                                            frame,
                                            line.bounds,
                                            lineCount,
                                            line.lineHeightHint,
                                        );
                                        return (
                                            <div
                                                class="absolute rounded-sm"
                                                style={{
                                                    left: `${presentation.left}px`,
                                                    top: `${presentation.top}px`,
                                                    width: `${presentation.width}px`,
                                                    height: `${presentation.height}px`,
                                                    "background-color": ocrOverlayFillColor().hex,
                                                    "box-sizing": "border-box",
                                                    overflow: "hidden",
                                                    "pointer-events": "none",
                                                }}
                                            />
                                        );
                                    }}</For>
                                );
                            }}</For>
                        </div>
                        {/* Text is deliberately above all opaque fills. OCR
                            detector boxes often overlap by a few pixels; painting
                            each label after the full fill pass keeps every row readable. */}
                        <div class="absolute inset-0 pointer-events-none" style={{ "z-index": 16 }}>
                            <For each={ocrOverlayBlocks()}>{(block) => {
                                const frame = resolveOcrImageFrame(props.unit, props.isMinified);
                                if (!frame) return null;
                                const label = block.text;
                                const copiedLabel = block.copyText;
                                const visualLines = resolveOcrOverlayVisualLines(block);
                                const lineCount = Math.max(1, label.split(/\r\n|\r|\n/).length);
                                const presentation = resolveOcrBlockPresentation(
                                    frame,
                                    block.bounds,
                                    lineCount,
                                    block.lineHeightHint,
                                );
                                // For keeps each mapped child stable. Read the signal through
                                // an accessor so Ctrl+2 can enable an already-rendered block
                                // without requiring a minimize/restore remount.
                                const isInteractive = () => ocrInteractiveUnitId() === props.unit.id;
                                const foregroundColor = resolveReadableOcrColor(
                                    resolveOcrOverlayColor(block.colorHex, "#ffffff").slice(0, 7),
                                    ocrOverlayFillColor().hex,
                                );
                                return (
                                    <div
                                        class="absolute rounded-sm"
                                        style={{
                                            left: `${presentation.left}px`,
                                            top: `${presentation.top}px`,
                                            width: `${presentation.width}px`,
                                            height: `${presentation.height}px`,
                                            color: foregroundColor,
                                            "box-sizing": "border-box",
                                            // This layer remains transparent so the
                                            // shared fill is visible between glyphs.
                                            overflow: "visible",
                                            "pointer-events": isInteractive() ? "auto" : "none",
                                            cursor: isInteractive() ? "copy" : "default",
                                            "user-select": isInteractive() ? "text" : "none",
                                        }}
                                        role={isInteractive() ? "button" : undefined}
                                        aria-label={isInteractive() ? label : undefined}
                                        tabIndex={isInteractive() ? 0 : undefined}
                                        onMouseDown={(event) => {
                                            if (!isInteractive() || event.button !== 0) return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            // The native overlay can resolve mouse-up to a
                                            // neighbouring overlapping OCR block. Copy on the
                                            // stable primary-button down target rather than
                                            // waiting for a synthetic click that may be dropped.
                                            requestOcrCopy(props.unit.id, copiedLabel);
                                        }}
                                        onClick={(event) => {
                                            if (!isInteractive()) return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                        }}
                                        onKeyDown={(event) => {
                                            if (
                                                !isInteractive()
                                                || event.repeat
                                                || (event.key !== "Enter" && event.key !== " ")
                                            ) return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            requestOcrCopy(props.unit.id, copiedLabel);
                                        }}
                                    >
                                        <For each={visualLines}>{(line) => {
                                            const rowLineCount = Math.max(1, line.text.split(/\r\n|\r|\n/).length);
                                            const rowPresentation = resolveOcrBlockPresentation(
                                                frame,
                                                line.bounds,
                                                rowLineCount,
                                                line.lineHeightHint,
                                            );
                                            const typography = resolveOcrTextTypography({
                                                text: line.text,
                                                width: rowPresentation.width,
                                                paddingX: rowPresentation.paddingX,
                                                fontSize: rowPresentation.fontSize,
                                                lineHeight: rowPresentation.lineHeight,
                                                fontFamily: ocrOverlayFontFamily(),
                                                containOverflow: rowPresentation.fontSize <= 10
                                                    || rowPresentation.left <= frame.left + 1
                                                    || rowPresentation.top <= frame.top + 1
                                                    || rowPresentation.left + rowPresentation.width >= frame.left + frame.width - 1
                                                    || rowPresentation.top + rowPresentation.height >= frame.top + frame.height - 1,
                                            });
                                            const baselinePlacement = resolveOcrBaselineTextPlacement(
                                                frame,
                                                line.lineGeometry,
                                                rowPresentation,
                                                typography.fontSize,
                                            );
                                            const textPlacement = baselinePlacement ?? rowPresentation;
                                            return (
                                                <div
                                                    class="absolute whitespace-pre"
                                                    style={{
                                                        left: `${textPlacement.left - presentation.left}px`,
                                                        top: `${textPlacement.top - presentation.top}px`,
                                                        width: `${textPlacement.width}px`,
                                                        height: `${textPlacement.height}px`,
                                                        color: foregroundColor,
                                                        "background-color": "transparent",
                                                        "font-size": `${typography.fontSize}px`,
                                                        "line-height": `${rowPresentation.lineHeight}px`,
                                                        "padding-left": `${rowPresentation.paddingX}px`,
                                                        "padding-right": `${rowPresentation.paddingX}px`,
                                                        "font-family": ocrOverlayFontFamily(),
                                                        "font-weight": "500",
                                                        "font-kerning": "normal",
                                                        "text-rendering": "geometricPrecision",
                                                        "display": "block",
                                                        "box-sizing": "border-box",
                                                        overflow: "visible",
                                                        transform: baselinePlacement
                                                            ? `rotate(${baselinePlacement.angleDegrees}deg)`
                                                            : undefined,
                                                        "transform-origin": baselinePlacement
                                                            ? `0 ${baselinePlacement.baselineOffset}px`
                                                            : undefined,
                                                    }}
                                                    title={line.text}
                                                >
                                                    <span
                                                        style={{
                                                            display: "inline-block",
                                                            "letter-spacing": `${typography.letterSpacing}px`,
                                                            transform: `scaleX(${typography.scaleX})`,
                                                            "transform-origin": "left top",
                                                        }}
                                                    >
                                                        {line.text}
                                                    </span>
                                                </div>
                                            );
                                        }}</For>
                                    </div>
                                );
                            }}</For>
                        </div>
                    </div>
                </div>
            )}</Show>
        </Show>

        <BarcodeVisualOverlay unit={props.unit} isMinified={props.isMinified} />

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
};

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
