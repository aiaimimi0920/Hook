import type { StickerPoint } from "../types/stickerEditing";

const MAX_CANVAS_DIMENSION = 1_000_000;
const MAX_COORDINATE = 1_000_000;

export const clampFiniteNumber = (
    value: number,
    fallback: number,
    min: number,
    max: number,
) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));

export const sanitizeCanvasDimension = (value: number) =>
    clampFiniteNumber(value, 1, 1, MAX_CANVAS_DIMENSION);

export const sanitizeStrokeWidth = (value: number, minimum = 0) =>
    clampFiniteNumber(value, 3, minimum, 96);

export const sanitizeShapeCornerRadius = (value: number) =>
    clampFiniteNumber(value, 0, 0, 256);

export const sanitizeShapeSnapStep = (value: number) =>
    clampFiniteNumber(value, 0, 0, 50);

export const sanitizePolygonSides = (value: number) =>
    Math.round(clampFiniteNumber(value, 6, 3, 12));

export const sanitizeEffectBrushSize = (value: number) =>
    clampFiniteNumber(value, 28, 4, 200);

export const sanitizeEffectStrength = (value: number, fallback: number) =>
    clampFiniteNumber(value, fallback, 2, 64);

export const sanitizeContentEraserSize = (value: number) =>
    clampFiniteNumber(value, 20, 4, 96);

export const sanitizeTextSize = (value: number) =>
    clampFiniteNumber(value, 16, 8, 96);

export const sanitizeSerialRadius = (value: number) =>
    clampFiniteNumber(value, 14, 8, 96);

export const sanitizeRotation = (value: number | undefined) =>
    clampFiniteNumber(value ?? 0, 0, -36_000, 36_000);

export const sanitizeStickerPoint = (point: StickerPoint): StickerPoint | null => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return {
        x: clampFiniteNumber(point.x, 0, -MAX_COORDINATE, MAX_COORDINATE),
        y: clampFiniteNumber(point.y, 0, -MAX_COORDINATE, MAX_COORDINATE),
    };
};

export const sanitizeStickerPoints = (points: StickerPoint[]) =>
    points.flatMap((point) => {
        const sanitized = sanitizeStickerPoint(point);
        return sanitized ? [sanitized] : [];
    });

export const sanitizeStickerRect = (
    rect: { x: number; y: number; w: number; h: number },
) => {
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return null;
    return {
        x: clampFiniteNumber(rect.x, 0, -MAX_COORDINATE, MAX_COORDINATE),
        y: clampFiniteNumber(rect.y, 0, -MAX_COORDINATE, MAX_COORDINATE),
        w: clampFiniteNumber(rect.w, 0, 0, MAX_CANVAS_DIMENSION),
        h: clampFiniteNumber(rect.h, 0, 0, MAX_CANVAS_DIMENSION),
    };
};
