import type { StickerPoint } from "../types/stickerEditing";

/**
 * Resolve a canvas line-dash array (in px) from the annotation dash pattern,
 * scaled by stroke width so the pattern stays proportional. Mirrors the SVG
 * stroke-dasharray used in the live layer.
 */
export const getDashSegments = (
    dashPattern: "solid" | "dash-1" | "dash-2" | undefined,
    width: number,
): number[] => {
    if (!dashPattern || dashPattern === "solid") return [];
    const unit = Math.max(1, width);
    if (dashPattern === "dash-1") return [8 * unit, 4 * unit];
    if (dashPattern === "dash-2") return [4 * unit, 2 * unit, 1 * unit, 2 * unit];
    return [];
};

/**
 * Apply line dash pattern to canvas context, guarded against incomplete mock implementations.
 */
export const applyLineDash = (
    context: CanvasRenderingContext2D,
    dashPattern: "solid" | "dash-1" | "dash-2" | undefined,
    width: number,
) => {
    if (typeof context.setLineDash !== "function") return;
    context.setLineDash(getDashSegments(dashPattern, width));
};

/**
 * Draw a stroked path through the given points on a canvas context.
 * Handles single-point paths as circles, multi-point paths as polylines.
 * Supports opacity and optional dash patterns.
 */
export const drawStrokePath = (
    context: CanvasRenderingContext2D,
    points: StickerPoint[],
    style: {
        color: string;
        width: number;
        opacity?: number;
        dashPattern?: "solid" | "dash-1" | "dash-2";
    },
) => {
    if (points.length < 1) return;

    context.save();
    context.globalAlpha = style.opacity ?? 1;

    // Single point: draw as a circle
    if (points.length === 1) {
        context.fillStyle = style.color;
        context.beginPath();
        context.arc(points[0].x, points[0].y, Math.max(0.5, style.width / 2), 0, Math.PI * 2);
        context.fill();
        context.restore();
        return;
    }

    // Multi-point: draw as a polyline
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
        context.lineTo(points[index].x, points[index].y);
    }
    context.strokeStyle = style.color;
    context.lineWidth = style.width;
    // A round cap extends each dash by half the stroke width on both ends,
    // which fills the gaps and makes a dashed line look solid. Use a butt cap
    // whenever a dash pattern is active so the gaps stay visible.
    const dashSegments = style.dashPattern ? getDashSegments(style.dashPattern, style.width) : [];
    context.lineCap = dashSegments.length > 0 ? "butt" : "round";
    context.lineJoin = "round";
    if (style.dashPattern) {
        applyLineDash(context, style.dashPattern, style.width);
    }
    context.stroke();
    context.restore();
};

/**
 * Load an image from a data URL or file path.
 */
export const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        if (!src) {
            reject(new Error("Cannot load image from empty source"));
            return;
        }
        const image = new Image();
        // Non-data/blob sources (e.g. file:/asset: paths) taint the canvas unless
        // they are loaded as crossOrigin, which makes a later toDataURL throw a
        // SecurityError. Request anonymous CORS for those so the rasterized erase
        // and export pipelines can read the canvas back.
        if (!src.startsWith("data:") && !src.startsWith("blob:")) {
            image.crossOrigin = "anonymous";
        }
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Failed to load image"));
        image.src = src;
    });
