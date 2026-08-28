import type { OcrLineGeometry } from "../types/unit";

interface CoordinateFrame {
    left: number;
    top: number;
    width: number;
    height: number;
    scaleX: number;
    scaleY: number;
}

interface LineBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

interface TextPresentation {
    left: number;
    top: number;
    width: number;
    height: number;
    lineHeight: number;
}

export interface OcrBaselineTextPlacement extends TextPresentation {
    angleDegrees: number;
    baselineOffset: number;
}

const MAX_BASELINE_ANGLE_DEGREES = 30;
const BASELINE_ASCENT_RATIO = 0.82;

const isFinitePoint = (point: unknown): point is { x: number; y: number } => {
    if (!point || typeof point !== "object") return false;
    const candidate = point as { x?: unknown; y?: unknown };
    return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
};

const deriveAngleDegrees = (geometry: OcrLineGeometry) => {
    const [start, end] = geometry.baseline;
    return Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
};

/** Narrows untrusted Loom geometry before it can reach CSS coordinates. */
export const normalizeOcrLineGeometry = (
    geometry: OcrLineGeometry | undefined,
    bounds: LineBounds,
    coordinateScale = 1,
): OcrLineGeometry | undefined => {
    if (
        geometry?.source !== "estimatedFromRapidOcrLineQuad"
        || !Array.isArray(geometry.baseline)
        || geometry.baseline.length !== 2
        || !geometry.baseline.every(isFinitePoint)
        || !Number.isFinite(geometry.angleDegrees)
        || !Number.isFinite(coordinateScale)
        || coordinateScale <= 0
    ) return undefined;

    const baseline = geometry.baseline.map((point) => ({
        x: point.x / coordinateScale,
        y: point.y / coordinateScale,
    })) as OcrLineGeometry["baseline"];
    const normalized = { ...geometry, baseline };
    const angleDegrees = deriveAngleDegrees(normalized);
    const length = Math.hypot(
        baseline[1].x - baseline[0].x,
        baseline[1].y - baseline[0].y,
    );
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const margin = Math.max(2, width, height) * 0.5;
    const nearBounds = baseline.every((point) =>
        point.x >= bounds.minX - margin
        && point.x <= bounds.maxX + margin
        && point.y >= bounds.minY - margin
        && point.y <= bounds.maxY + margin,
    );
    if (
        !Number.isFinite(angleDegrees)
        || Math.abs(angleDegrees) > MAX_BASELINE_ANGLE_DEGREES
        || !Number.isFinite(length)
        || length <= 0
        || !nearBounds
    ) return undefined;

    return { ...normalized, angleDegrees };
};

/** Keeps a baseline attached when row collision normalization adjusts bounds. */
export const remapOcrLineGeometry = (
    geometry: OcrLineGeometry | undefined,
    from: LineBounds,
    to: LineBounds,
): OcrLineGeometry | undefined => {
    if (!geometry) return undefined;
    const fromWidth = from.maxX - from.minX;
    const fromHeight = from.maxY - from.minY;
    if (fromWidth <= 0 || fromHeight <= 0) return undefined;
    const toWidth = to.maxX - to.minX;
    const toHeight = to.maxY - to.minY;
    const baseline = geometry.baseline.map((point) => ({
        x: to.minX + (point.x - from.minX) / fromWidth * toWidth,
        y: to.minY + (point.y - from.minY) / fromHeight * toHeight,
    })) as OcrLineGeometry["baseline"];
    const remapped = { ...geometry, baseline };
    return { ...remapped, angleDegrees: deriveAngleDegrees(remapped) };
};

/** Anchors browser glyphs to Loom's estimated source-image baseline. */
export const resolveOcrBaselineTextPlacement = (
    frame: CoordinateFrame,
    geometry: OcrLineGeometry | undefined,
    fallback: TextPresentation,
    fontSize: number,
): OcrBaselineTextPlacement | undefined => {
    if (!geometry || !Number.isFinite(fontSize) || fontSize <= 0) return undefined;
    const [sourceStart, sourceEnd] = geometry.baseline;
    const start = {
        x: frame.left + sourceStart.x * frame.scaleX,
        y: frame.top + sourceStart.y * frame.scaleY,
    };
    const end = {
        x: frame.left + sourceEnd.x * frame.scaleX,
        y: frame.top + sourceEnd.y * frame.scaleY,
    };
    const width = Math.hypot(end.x - start.x, end.y - start.y);
    const angleDegrees = Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI;
    if (!Number.isFinite(width) || width <= 0 || Math.abs(angleDegrees) > MAX_BASELINE_ANGLE_DEGREES) {
        return undefined;
    }
    const baselineOffset = Math.max(
        1,
        (fallback.lineHeight - fontSize) / 2 + fontSize * BASELINE_ASCENT_RATIO,
    );
    const top = start.y - baselineOffset;
    const radians = angleDegrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const corners = [
        [0, -baselineOffset],
        [width, -baselineOffset],
        [width, fallback.height - baselineOffset],
        [0, fallback.height - baselineOffset],
    ].map(([x, y]) => ({
        x: start.x + x * cosine - y * sine,
        y: start.y + x * sine + y * cosine,
    }));
    const frameRight = frame.left + frame.width;
    const frameBottom = frame.top + frame.height;
    if (corners.some((point) =>
        point.x < frame.left
        || point.x > frameRight
        || point.y < frame.top
        || point.y > frameBottom)) return undefined;
    return {
        left: start.x,
        top,
        width,
        height: fallback.height,
        lineHeight: fallback.lineHeight,
        angleDegrees,
        baselineOffset,
    };
};
