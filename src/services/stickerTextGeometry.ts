import type { StickerAnnotation } from "../types/stickerEditing";
import { buildSerialAnnotationMetrics } from "./stickerEditing";

export const DEFAULT_TEXT_FONT_SIZE = 18;
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
export const measureTextWidth = (
    text: string,
    fontSize: number,
    fontWeight: "500" | "700" = "500",
    fontFamily = "Segoe UI",
) => {
    const safeText = typeof text === "string" ? text : "";
    const context = getTextMeasurementContext();
    if (context) {
        context.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
        const width = context.measureText(safeText).width;
        if (Number.isFinite(width) && width > 0) {
            return width;
        }
    }

    return Math.max(fontSize, safeText.length * fontSize * DEFAULT_TEXT_WIDTH_FACTOR);
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
    return {
        width,
        height: fontSize,
        left: annotation.x,
        top: annotation.y - fontSize,
        centerY: annotation.y - fontSize / 2,
        fontSize,
    };
};
