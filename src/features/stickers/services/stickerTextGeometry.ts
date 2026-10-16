import type { StickerAnnotation } from "../types/stickerEditing";
import { buildSerialAnnotationMetrics } from "./stickerEditing";

export const DEFAULT_TEXT_FONT_SIZE = 18;
export const TEXT_FRAME_PADDING = 4;
const DEFAULT_TEXT_WIDTH_FACTOR = 0.6;
let textMeasurementContext: CanvasRenderingContext2D | null = null;

const getTextMeasurementContext = () => {
    if (textMeasurementContext) return textMeasurementContext;
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
        return null;
    }

    // A single detached canvas context is sufficient for every measurement.
    textMeasurementContext = document.createElement("canvas").getContext("2d");
    return textMeasurementContext;
};

/** Measures rendered text when a canvas is available and otherwise uses a deterministic fallback. */
export const measureTextLayout = (
    text: string,
    fontSize: number,
    fontWeight: "500" | "700" = "500",
    fontFamily = "Segoe UI",
) => {
    const safeText = typeof text === "string" ? text : "";
    const context = getTextMeasurementContext();
    if (context) {
        context.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
        const metrics = context.measureText(safeText);
        const width = metrics.width;
        if (Number.isFinite(width) && width > 0) {
            // Frame the actual ink, not the font's reserved line box. Otherwise
            // the font's unequal ascent/descent whitespace survives the padding.
            const hasInk = Number.isFinite(metrics.actualBoundingBoxAscent)
                && Number.isFinite(metrics.actualBoundingBoxDescent)
                && metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent > 0;
            const ascent = hasInk ? metrics.actualBoundingBoxAscent
                : Number.isFinite(metrics.fontBoundingBoxAscent) ? metrics.fontBoundingBoxAscent : fontSize;
            const descent = hasInk ? metrics.actualBoundingBoxDescent
                : Number.isFinite(metrics.fontBoundingBoxDescent) ? metrics.fontBoundingBoxDescent : fontSize * 0.25;
            return { width, ascent, descent, height: ascent + descent };
        }
    }

    return { width: Math.max(fontSize, safeText.length * fontSize * DEFAULT_TEXT_WIDTH_FACTOR),
        ascent: fontSize, descent: fontSize * 0.25, height: fontSize * 1.25 };
};

export const measureTextWidth = (text: string, fontSize: number, fontWeight: "500" | "700" = "500", fontFamily = "Segoe UI") =>
    measureTextLayout(text, fontSize, fontWeight, fontFamily).width;

/** Fixed font-wide line box; Han and descenders must fit without resizing while typing. */
export const getTextLineMetrics = (fontSize: number, fontFamily?: string) => {
    let ascent = fontSize;
    let descent = fontSize * 0.25;
    let sidePadding = TEXT_FRAME_PADDING;
    const context = getTextMeasurementContext();
    if (context) {
        context.font = `500 ${fontSize}px "${fontFamily ?? "Segoe UI"}", sans-serif`;
        const metrics = context.measureText("国你好AgjpqyÉÅ");
        ascent = Math.max(
            Number.isFinite(metrics.fontBoundingBoxAscent) ? metrics.fontBoundingBoxAscent : ascent,
            Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : 0,
        );
        descent = Math.max(
            Number.isFinite(metrics.fontBoundingBoxDescent) ? metrics.fontBoundingBoxDescent : descent,
            Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : 0,
        );
        const overhang = context.measureText("j");
        sidePadding = Math.max(sidePadding,
            Number.isFinite(overhang.actualBoundingBoxLeft) ? Math.ceil(overhang.actualBoundingBoxLeft) + 2 : 0,
            Number.isFinite(overhang.actualBoundingBoxRight) ? Math.ceil(overhang.actualBoundingBoxRight - overhang.width) + 2 : 0);
    }
    // Border clearance is fixed too; it must not consume the font's descent area.
    return { height: ascent + descent + TEXT_FRAME_PADDING * 2,
        baselineOffset: (ascent - descent) / 2, sidePadding };
};

/** Baseline-aware dimensions shared by selection, transforms and export-adjacent geometry. */
export const getTextAnnotationMetrics = (
    annotation: Extract<StickerAnnotation, { type: "text" | "serial" }>,
) => {
    if (annotation.type === "serial") {
        const serialMetrics = buildSerialAnnotationMetrics(annotation.style.cornerRadius ?? 14);
        const fontSize = annotation.fontSize ?? serialMetrics.fontSize;
        const centerY = annotation.y - fontSize / 2;
        return {
            width: serialMetrics.radius * 2,
            height: serialMetrics.radius * 2,
            left: annotation.x,
            top: centerY - serialMetrics.radius,
            centerY,
            fontSize,
        };
    }

    const fontSize = annotation.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
    const width = measureTextWidth(annotation.text, fontSize, "500", annotation.fontFamily);
    const line = getTextLineMetrics(fontSize, annotation.fontFamily);
    return {
        width,
        height: line.height,
        left: annotation.x,
        top: annotation.y - line.baselineOffset - line.height / 2,
        centerY: annotation.y - line.baselineOffset,
        fontSize,
    };
};
