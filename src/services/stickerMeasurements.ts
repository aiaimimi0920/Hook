import { clamp } from "../utils/math";

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Size = { w: number; h: number };

export type MeasurementShapeMode =
    | "crop"
    | "shape-rect"
    | "shape-round-rect"
    | "shape-ellipse"
    | "shape-triangle"
    | "shape-polygon"
    | "mosaic"
    | "blur";

export type MeasurementBadge = {
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    textX: number;
    textY: number;
};

const BADGE_MARGIN = 4;
const BADGE_HEIGHT = 20;
const BADGE_TEXT_OFFSET_X = 6;
const BADGE_TEXT_OFFSET_Y = 14;
const BADGE_GAP = 6;
const MIN_BADGE_WIDTH = 44;
const ESTIMATED_CHAR_WIDTH = 7;

const displayDimension = (value: number) => Math.max(0, Math.round(value));

export const formatShapeMeasurement = (mode: MeasurementShapeMode, rect: Rect) => {
    const width = displayDimension(rect.w);
    const height = displayDimension(rect.h);
    if (mode === "shape-ellipse" && width === height) {
        return `r = ${Math.round(width / 2)}`;
    }
    return `${width} x ${height}`;
};

export const formatLineMeasurement = (points: Point[]) => {
    if (points.length < 2) return null;
    const start = points[0];
    const end = points[points.length - 1];
    return `L = ${Math.round(Math.hypot(end.x - start.x, end.y - start.y))}`;
};

export const buildMeasurementBadge = (
    label: string,
    anchor: Point,
    bounds: Size,
): MeasurementBadge => {
    const width = Math.max(MIN_BADGE_WIDTH, Math.ceil(label.length * ESTIMATED_CHAR_WIDTH + 12));
    const maxX = bounds.w - width - BADGE_MARGIN;
    const maxY = bounds.h - BADGE_HEIGHT - BADGE_MARGIN;
    const x = clamp(anchor.x, BADGE_MARGIN, maxX);
    const preferredAboveY = anchor.y - BADGE_HEIGHT - BADGE_GAP;
    const fallbackBelowY = anchor.y + BADGE_GAP;
    const y = preferredAboveY >= BADGE_MARGIN
        ? preferredAboveY
        : clamp(fallbackBelowY, BADGE_MARGIN, maxY);

    return {
        label,
        x,
        y,
        width,
        height: BADGE_HEIGHT,
        textX: x + BADGE_TEXT_OFFSET_X,
        textY: y + BADGE_TEXT_OFFSET_Y,
    };
};

export const buildShapeMeasurementBadge = (
    mode: MeasurementShapeMode,
    rect: Rect,
    bounds: Size,
) => {
    if (rect.w < 1 && rect.h < 1) return null;
    return buildMeasurementBadge(formatShapeMeasurement(mode, rect), { x: rect.x, y: rect.y }, bounds);
};

export const buildLineMeasurementBadge = (points: Point[], bounds: Size) => {
    const label = formatLineMeasurement(points);
    if (!label) return null;
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    return buildMeasurementBadge(label, { x: minX, y: minY }, bounds);
};
