import { unwrap } from "solid-js/store";
import type { StickerAnnotation, StickerPoint } from "../types/stickerEditing";
import { buildSerialAnnotationMetrics } from "./stickerEditing";

export type ResizeHandle = "nw" | "ne" | "sw" | "se";
export type LineEndpointHandle = "start" | "end";

const pointToSegmentDistance = (point: StickerPoint, start: StickerPoint, end: StickerPoint) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) {
        return Math.hypot(point.x - start.x, point.y - start.y);
    }

    const t = Math.max(
        0,
        Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
    );
    const projX = start.x + t * dx;
    const projY = start.y + t * dy;
    return Math.hypot(point.x - projX, point.y - projY);
};

const isPointInEllipse = (point: StickerPoint, x: number, y: number, w: number, h: number) => {
    const rx = w / 2;
    const ry = h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const cx = x + rx;
    const cy = y + ry;
    return (((point.x - cx) ** 2) / (rx ** 2)) + (((point.y - cy) ** 2) / (ry ** 2)) <= 1;
};

const isPointInPolygon = (point: StickerPoint, vertices: StickerPoint[]) => {
    if (vertices.length < 3) return false;

    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
        const xi = vertices[i].x;
        const yi = vertices[i].y;
        const xj = vertices[j].x;
        const yj = vertices[j].y;

        const intersects =
            yi > point.y !== yj > point.y &&
            point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
        if (intersects) {
            inside = !inside;
        }
    }

    return inside;
};

const getArrowHeadAnchorSegmentInfo = (
    points: StickerPoint[],
    minDistance = 6,
): { from: StickerPoint; to: StickerPoint; fromIndex: number; toIndex: number } | null => {
    if (points.length < 2) return null;

    const toIndex = points.length - 1;
    const to = points[points.length - 1];
    for (let index = points.length - 2; index >= 0; index -= 1) {
        const from = points[index];
        if (Math.hypot(to.x - from.x, to.y - from.y) >= minDistance) {
            return { from, to, fromIndex: index, toIndex };
        }
    }

    for (let index = points.length - 2; index >= 0; index -= 1) {
        const from = points[index];
        if (from.x !== to.x || from.y !== to.y) {
            return { from, to, fromIndex: index, toIndex };
        }
    }

    return null;
};

export const getArrowHeadAnchorSegment = (
    points: StickerPoint[],
    minDistance = 6,
): { from: StickerPoint; to: StickerPoint } | null => {
    const segment = getArrowHeadAnchorSegmentInfo(points, minDistance);
    return segment ? { from: segment.from, to: segment.to } : null;
};

const getArrowHeadGeometry = (
    points: StickerPoint[],
    options?: {
        headLength?: number;
        headWidth?: number;
        minDistance?: number;
    },
) => {
    const segment = getArrowHeadAnchorSegmentInfo(points, options?.minDistance ?? 6);
    if (!segment) return null;

    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const segmentLength = Math.hypot(dx, dy);
    if (segmentLength === 0) return null;

    const headLength = Math.min(options?.headLength ?? 12, segmentLength);
    const headWidth = options?.headWidth ?? 8;
    const angle = Math.atan2(dy, dx);
    const baseX = segment.to.x - Math.cos(angle) * headLength;
    const baseY = segment.to.y - Math.sin(angle) * headLength;
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    const halfWidth = headWidth / 2;

    return {
        ...segment,
        base: { x: baseX, y: baseY },
        leftBase: { x: baseX + normalX * halfWidth, y: baseY + normalY * halfWidth },
        rightBase: { x: baseX - normalX * halfWidth, y: baseY - normalY * halfWidth },
    };
};

export const buildArrowHeadPolygon = (
    points: StickerPoint[],
    options?: {
        headLength?: number;
        headWidth?: number;
        minDistance?: number;
    },
) => {
    const geometry = getArrowHeadGeometry(points, options);
    if (!geometry) return null;

    return [
        { x: geometry.to.x, y: geometry.to.y },
        geometry.leftBase,
        geometry.rightBase,
    ];
};

export const getArrowShaftPoints = (
    points: StickerPoint[],
    options?: {
        headLength?: number;
        minDistance?: number;
    },
) => {
    const geometry = getArrowHeadGeometry(points, options);
    if (!geometry) {
        return points.map((point) => ({ ...point }));
    }

    const shaftPoints = points
        .slice(0, geometry.fromIndex + 1)
        .map((point) => ({ ...point }));
    const last = shaftPoints[shaftPoints.length - 1];
    if (!last || last.x !== geometry.base.x || last.y !== geometry.base.y) {
        shaftPoints.push(geometry.base);
    }
    return shaftPoints;
};

export const annotationContainsPoint = (
    annotation: StickerAnnotation,
    point: StickerPoint,
    tolerance = 8,
) => {
    const boundsContainsPoint = (bounds: { x: number; y: number; w: number; h: number }) =>
        point.x >= bounds.x - tolerance &&
        point.x <= bounds.x + bounds.w + tolerance &&
        point.y >= bounds.y - tolerance &&
        point.y <= bounds.y + bounds.h + tolerance;

    switch (annotation.type) {
        case "rect":
        case "round-rect":
        case "mosaic":
        case "blur":
            return boundsContainsPoint(getAnnotationBounds(annotation));
        case "ellipse":
            return annotation.rotation
                ? boundsContainsPoint(getAnnotationBounds(annotation))
                : isPointInEllipse(point, annotation.x, annotation.y, annotation.w, annotation.h);
        case "triangle":
            return annotation.rotation
                ? boundsContainsPoint(getAnnotationBounds(annotation))
                : isPointInPolygon(point, buildTrianglePoints(annotation));
        case "polygon":
            return annotation.rotation
                ? boundsContainsPoint(getAnnotationBounds(annotation))
                : isPointInPolygon(point, buildPolygonPoints(annotation, annotation.sides ?? MIN_POLYGON_SIDES));
        case "serial":
        case "text":
            return boundsContainsPoint(getAnnotationBounds(annotation));
        case "line":
        case "polyline":
        case "arrow":
        case "brush":
        case "highlighter": {
            for (let index = 1; index < annotation.points.length; index += 1) {
                if (
                    pointToSegmentDistance(point, annotation.points[index - 1], annotation.points[index]) <=
                    Math.max(tolerance, annotation.style.width)
                ) {
                    return true;
                }
            }
            return false;
        }
        default:
            return false;
    }
};

export const findTopmostAnnotationAtPoint = (
    annotations: StickerAnnotation[],
    point: StickerPoint,
    tolerance = 8,
) => {
    const sorted = [...annotations].sort((left, right) => right.zIndex - left.zIndex);
    return sorted.find((annotation) => annotationContainsPoint(annotation, point, tolerance));
};

export const translateAnnotation = (
    annotation: StickerAnnotation,
    deltaX: number,
    deltaY: number,
): StickerAnnotation => {
    switch (annotation.type) {
        case "mosaic":
        case "blur":
            return {
                ...annotation,
                x: annotation.x + deltaX,
                y: annotation.y + deltaY,
                // Brush-painted effects carry a stroke path; keep it in sync with
                // the bounding box so the mask follows the move.
                points: annotation.points
                    ? annotation.points.map((p) => ({ x: p.x + deltaX, y: p.y + deltaY }))
                    : annotation.points,
            };
        case "rect":
        case "round-rect":
        case "ellipse":
        case "triangle":
        case "polygon":
            return {
                ...annotation,
                x: annotation.x + deltaX,
                y: annotation.y + deltaY,
            };
        case "text":
        case "serial":
            return {
                ...annotation,
                x: annotation.x + deltaX,
                y: annotation.y + deltaY,
            };
        case "line":
        case "polyline":
        case "arrow":
        case "brush":
        case "highlighter":
            return {
                ...annotation,
                points: annotation.points.map((point) => ({
                    x: point.x + deltaX,
                    y: point.y + deltaY,
                })),
            };
        default:
            return annotation;
    }
};

export const cloneStickerAnnotation = (annotation: StickerAnnotation): StickerAnnotation =>
    structuredClone(unwrap(annotation));

export const resizeBoxAnnotation = (
    annotation: StickerAnnotation,
    handle: ResizeHandle,
    point: StickerPoint,
    minSize = 16,
): StickerAnnotation => {
    if (!("w" in annotation) || !("h" in annotation)) {
        return annotation;
    }

    const left = annotation.x;
    const top = annotation.y;
    const right = annotation.x + annotation.w;
    const bottom = annotation.y + annotation.h;

    let nextLeft = left;
    let nextTop = top;
    let nextRight = right;
    let nextBottom = bottom;

    switch (handle) {
        case "nw":
            nextLeft = Math.min(point.x, right - minSize);
            nextTop = Math.min(point.y, bottom - minSize);
            break;
        case "ne":
            nextRight = Math.max(point.x, left + minSize);
            nextTop = Math.min(point.y, bottom - minSize);
            break;
        case "sw":
            nextLeft = Math.min(point.x, right - minSize);
            nextBottom = Math.max(point.y, top + minSize);
            break;
        case "se":
            nextRight = Math.max(point.x, left + minSize);
            nextBottom = Math.max(point.y, top + minSize);
            break;
    }

    const nextWidth = nextRight - nextLeft;
    const nextHeight = nextBottom - nextTop;

    // Brush-stroke effects (mosaic/blur) carry a points array that drives the
    // mask. Scale those points along with the box so the painted region keeps
    // following the handles instead of desyncing from the bounding box.
    if ("points" in annotation && Array.isArray(annotation.points) && annotation.points.length > 0) {
        const scaleX = annotation.w !== 0 ? nextWidth / annotation.w : 1;
        const scaleY = annotation.h !== 0 ? nextHeight / annotation.h : 1;
        const scaledPoints = annotation.points.map((currentPoint) => ({
            x: nextLeft + (currentPoint.x - left) * scaleX,
            y: nextTop + (currentPoint.y - top) * scaleY,
        }));
        return {
            ...annotation,
            x: nextLeft,
            y: nextTop,
            w: nextWidth,
            h: nextHeight,
            points: scaledPoints,
        };
    }

    return {
        ...annotation,
        x: nextLeft,
        y: nextTop,
        w: nextWidth,
        h: nextHeight,
    };
};

export const moveLineEndpoint = (
    annotation: StickerAnnotation,
    handle: LineEndpointHandle,
    point: StickerPoint,
): StickerAnnotation => {
    if (
        !(
            annotation.type === "line" ||
            annotation.type === "polyline" ||
            annotation.type === "arrow" ||
            annotation.type === "brush" ||
            annotation.type === "highlighter"
        )
    ) {
        return annotation;
    }

    if (annotation.points.length < 2) {
        return annotation;
    }

    const points = annotation.points.map((currentPoint, index) => {
        if (handle === "start" && index === 0) {
            return { x: point.x, y: point.y };
        }
        if (handle === "end" && index === annotation.points.length - 1) {
            return { x: point.x, y: point.y };
        }
        return { x: currentPoint.x, y: currentPoint.y };
    });

    return {
        ...annotation,
        points,
    };
};

// --- Shared shape geometry ------------------------------------------------
// Single source of truth for triangle/polygon vertices, used by the live
// preview, the committed-annotation render, and the canvas export. Keeping
// one implementation prevents the preview and the exported image from drifting
// apart (a class of bug previously seen when each call site inlined its own
// vertex math with subtly different bounds).

export interface ShapeBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface AnnotationBounds extends ShapeBox {}

export interface AnnotationScale {
    x: number;
    y: number;
}

const DEFAULT_TEXT_FONT_SIZE = 18;
const DEFAULT_TEXT_WIDTH_FACTOR = 0.6;

const scaleStrokeWidth = (width: number, scaleX: number, scaleY: number) =>
    width * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2);

const getPointCloudBounds = (
    points: StickerPoint[] | undefined,
    padding = 0,
): AnnotationBounds | null => {
    if (!points || points.length < 1) {
        return null;
    }

    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs) - padding;
    const maxX = Math.max(...xs) + padding;
    const minY = Math.min(...ys) - padding;
    const maxY = Math.max(...ys) + padding;

    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
    };
};

const scalePointAround = (
    point: StickerPoint,
    pivot: StickerPoint,
    scale: AnnotationScale,
): StickerPoint => ({
    x: pivot.x + (point.x - pivot.x) * scale.x,
    y: pivot.y + (point.y - pivot.y) * scale.y,
});

const rotatePointAround = (
    point: StickerPoint,
    pivot: StickerPoint,
    angleDegrees: number,
): StickerPoint => {
    const radians = (angleDegrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = point.x - pivot.x;
    const dy = point.y - pivot.y;
    return {
        x: pivot.x + dx * cos - dy * sin,
        y: pivot.y + dx * sin + dy * cos,
    };
};

const normalizeRotation = (rotation: number | undefined, deltaDegrees = 0) => {
    const next = (rotation ?? 0) + deltaDegrees;
    if (!Number.isFinite(next)) return rotation;
    return next;
};

const measureTextWidth = (
    text: string,
    fontSize: number,
    fontWeight: "500" | "700" = "500",
    fontFamily = "Segoe UI",
) => {
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (context) {
            context.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
            const width = context.measureText(text).width;
            if (Number.isFinite(width) && width > 0) {
                return width;
            }
        }
    }

    return Math.max(fontSize, text.length * fontSize * DEFAULT_TEXT_WIDTH_FACTOR);
};

const getTextAnnotationMetrics = (annotation: Extract<StickerAnnotation, { type: "text" | "serial" }>) => {
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
        top: annotation.y,
        centerY: annotation.y + fontSize / 2,
        fontSize,
    };
};

const getRotatedRectBounds = (
    x: number,
    y: number,
    w: number,
    h: number,
    rotation = 0,
): AnnotationBounds => {
    if (!rotation) {
        return { x, y, w, h };
    }

    const center = { x: x + w / 2, y: y + h / 2 };
    const corners = [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
    ].map((point) => rotatePointAround(point, center, rotation));
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
    };
};

const scaleAnnotationStyle = <T extends { width: number; cornerRadius?: number }>(
    style: T,
    scale: AnnotationScale,
): T => ({
    ...style,
    width: scaleStrokeWidth(style.width, scale.x, scale.y),
    cornerRadius:
        style.cornerRadius === undefined
            ? undefined
            : scaleStrokeWidth(style.cornerRadius, scale.x, scale.y),
});

const rotateAnnotationAroundPivot = (
    annotation: StickerAnnotation,
    pivot: StickerPoint,
    angleDegrees: number,
): StickerAnnotation => {
    if (annotation.type === "mosaic" || annotation.type === "blur") {
        if (annotation.points && annotation.points.length > 0) {
            const points = annotation.points.map((point) =>
                rotatePointAround(point, pivot, angleDegrees),
            );
            const brushPadding = Math.max(1, annotation.brushWidth ?? annotation.style.width ?? 0) / 2;
            const bounds = getPointCloudBounds(points, brushPadding);
            if (bounds) {
                return {
                    ...annotation,
                    x: bounds.x,
                    y: bounds.y,
                    w: bounds.w,
                    h: bounds.h,
                    points,
                    rotation: undefined,
                };
            }
        }

        const center = getAnnotationCenter(annotation);
        const nextCenter = rotatePointAround(center, pivot, angleDegrees);
        return {
            ...annotation,
            x: nextCenter.x - annotation.w / 2,
            y: nextCenter.y - annotation.h / 2,
            rotation: normalizeRotation(annotation.rotation, angleDegrees),
        };
    }

    if (
        annotation.type === "rect" ||
        annotation.type === "round-rect" ||
        annotation.type === "ellipse" ||
        annotation.type === "triangle" ||
        annotation.type === "polygon"
    ) {
        const center = getAnnotationCenter(annotation);
        const nextCenter = rotatePointAround(center, pivot, angleDegrees);
        return {
            ...annotation,
            x: nextCenter.x - annotation.w / 2,
            y: nextCenter.y - annotation.h / 2,
            rotation: normalizeRotation(annotation.rotation, angleDegrees),
        };
    }

    if (annotation.type === "text" || annotation.type === "serial") {
        const metrics = getTextAnnotationMetrics(annotation);
        const center = getAnnotationCenter(annotation);
        const nextCenter = rotatePointAround(center, pivot, angleDegrees);
        return annotation.type === "serial"
            ? {
                  ...annotation,
                  x: nextCenter.x - metrics.width / 2,
                  y: nextCenter.y + metrics.fontSize / 2,
                  rotation: normalizeRotation(annotation.rotation, angleDegrees),
              }
            : {
                  ...annotation,
                  x: nextCenter.x - metrics.width / 2,
                  y: nextCenter.y - metrics.height / 2,
                  rotation: normalizeRotation(annotation.rotation, angleDegrees),
              };
    }

    const lineAnnotation = annotation as Extract<
        StickerAnnotation,
        { type: "line" | "polyline" | "arrow" | "brush" | "highlighter" }
    >;
    return {
        ...lineAnnotation,
        points: lineAnnotation.points.map((point: StickerPoint) =>
            rotatePointAround(point, pivot, angleDegrees),
        ),
    };
};

const scaleAnnotationAroundPivot = (
    annotation: StickerAnnotation,
    pivot: StickerPoint,
    scale: AnnotationScale,
): StickerAnnotation => {
    if (
        annotation.type === "rect" ||
        annotation.type === "round-rect" ||
        annotation.type === "ellipse" ||
        annotation.type === "triangle" ||
        annotation.type === "polygon"
    ) {
        const center = getAnnotationCenter(annotation);
        const nextCenter = scalePointAround(center, pivot, scale);
        const nextW = Math.abs(annotation.w * scale.x);
        const nextH = Math.abs(annotation.h * scale.y);
        return {
            ...annotation,
            x: nextCenter.x - nextW / 2,
            y: nextCenter.y - nextH / 2,
            w: nextW,
            h: nextH,
            style: scaleAnnotationStyle(annotation.style, scale),
        };
    }

    if (annotation.type === "mosaic" || annotation.type === "blur") {
        const points = annotation.points?.map((point) => scalePointAround(point, pivot, scale));
        const nextBrushWidth =
            annotation.brushWidth === undefined
                ? undefined
                : scaleStrokeWidth(annotation.brushWidth, scale.x, scale.y);
        const brushPadding = Math.max(1, nextBrushWidth ?? annotation.style.width ?? 0) / 2;
        const bounds = getPointCloudBounds(points, brushPadding);
        const center = getAnnotationCenter(annotation);
        const nextCenter = scalePointAround(center, pivot, scale);
        const nextW = Math.abs(annotation.w * scale.x);
        const nextH = Math.abs(annotation.h * scale.y);
        return {
            ...annotation,
            x: bounds?.x ?? (nextCenter.x - nextW / 2),
            y: bounds?.y ?? (nextCenter.y - nextH / 2),
            w: bounds?.w ?? nextW,
            h: bounds?.h ?? nextH,
            style: scaleAnnotationStyle(annotation.style, scale),
            points,
            brushWidth: nextBrushWidth,
            strength:
                annotation.strength === undefined
                    ? undefined
                    : scaleStrokeWidth(annotation.strength, scale.x, scale.y),
            rotation: points && points.length > 0 ? undefined : annotation.rotation,
        };
    }

    if (annotation.type === "text" || annotation.type === "serial") {
        const metrics = getTextAnnotationMetrics(annotation);
        const center = getAnnotationCenter(annotation);
        const nextCenter = scalePointAround(center, pivot, scale);
        const nextFontSize = scaleStrokeWidth(metrics.fontSize, scale.x, scale.y);
        if (annotation.type === "serial") {
            const serialMetrics = buildSerialAnnotationMetrics(
                scaleStrokeWidth(annotation.style.cornerRadius ?? 14, scale.x, scale.y),
            );
            const fontSize = annotation.fontSize === undefined ? serialMetrics.fontSize : nextFontSize;
            return {
                ...annotation,
                x: nextCenter.x - serialMetrics.radius,
                y: nextCenter.y + fontSize / 2,
                fontSize,
                style: scaleAnnotationStyle(
                    {
                        ...annotation.style,
                        cornerRadius: serialMetrics.radius,
                    },
                    scale,
                ),
            };
        }

        const fontSize = annotation.fontSize === undefined ? undefined : nextFontSize;
        const nextWidth = measureTextWidth(
            annotation.text,
            fontSize ?? DEFAULT_TEXT_FONT_SIZE,
            "500",
            annotation.fontFamily,
        );
        return {
            ...annotation,
            x: nextCenter.x - nextWidth / 2,
            y: nextCenter.y - (fontSize ?? DEFAULT_TEXT_FONT_SIZE) / 2,
            fontSize,
            style: scaleAnnotationStyle(annotation.style, scale),
        };
    }

    const lineAnnotation = annotation as Extract<
        StickerAnnotation,
        { type: "line" | "polyline" | "arrow" | "brush" | "highlighter" }
    >;
    return {
        ...lineAnnotation,
        points: lineAnnotation.points.map((point: StickerPoint) =>
            scalePointAround(point, pivot, scale),
        ),
        style: scaleAnnotationStyle(lineAnnotation.style, scale),
    };
};

// Minimum sides for a polygon; fewer would render a degenerate shape.
export const MIN_POLYGON_SIDES = 3;

// Triangle vertices: apex at top-center, base spanning the box bottom.
export const buildTrianglePoints = (box: ShapeBox): StickerPoint[] => [
    { x: box.x + box.w / 2, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
];

// Regular/irregular polygon vertices inscribed in the box's ellipse. The first
// vertex points straight up (-90°); sides is clamped to a sane minimum.
export const buildPolygonPoints = (box: ShapeBox, sides: number): StickerPoint[] => {
    const sideCount = Math.max(MIN_POLYGON_SIDES, Math.round(sides));
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const radiusX = box.w / 2;
    const radiusY = box.h / 2;
    return Array.from({ length: sideCount }, (_, i) => {
        const angle = (Math.PI * 2 * i) / sideCount - Math.PI / 2;
        return { x: cx + radiusX * Math.cos(angle), y: cy + radiusY * Math.sin(angle) };
    });
};

const formatPathNumber = (value: number) => {
    const rounded = Math.round(value * 1000) / 1000;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toString();
};

const normalizeVector = (dx: number, dy: number) => {
    const length = Math.hypot(dx, dy);
    if (length < 0.0001) {
        return { x: 0, y: 0, length: 0 };
    }
    return { x: dx / length, y: dy / length, length };
};

type RoundedCornerSpec = {
    corner: StickerPoint;
    entry: StickerPoint;
    exit: StickerPoint;
};

const buildRoundedCornerSpecs = (points: StickerPoint[], radius: number): RoundedCornerSpec[] => {
    if (points.length < 3) return [];

    return points.map((corner, index) => {
        const prev = points[(index - 1 + points.length) % points.length];
        const next = points[(index + 1) % points.length];
        const toPrev = normalizeVector(prev.x - corner.x, prev.y - corner.y);
        const toNext = normalizeVector(next.x - corner.x, next.y - corner.y);

        const maxOffset = Math.min(toPrev.length, toNext.length) / 2;
        const dot = Math.max(-1, Math.min(1, toPrev.x * toNext.x + toPrev.y * toNext.y));
        const angle = Math.acos(dot);
        const tangentOffset =
            angle > 0.0001 && Math.tan(angle / 2) > 0.0001
                ? radius / Math.tan(angle / 2)
                : radius;
        const offset = Math.max(0, Math.min(radius, tangentOffset, maxOffset));

        return {
            corner,
            entry: {
                x: corner.x + toPrev.x * offset,
                y: corner.y + toPrev.y * offset,
            },
            exit: {
                x: corner.x + toNext.x * offset,
                y: corner.y + toNext.y * offset,
            },
        };
    });
};

export const buildRoundedPolygonPath = (points: StickerPoint[], radius = 0): string => {
    if (points.length < 3) return "";
    if (radius <= 0) {
        return `M ${points.map((point) => `${formatPathNumber(point.x)} ${formatPathNumber(point.y)}`).join(" L ")} Z`;
    }

    const corners = buildRoundedCornerSpecs(points, radius);
    if (corners.length < 3) return "";

    const commands = [
        `M ${formatPathNumber(corners[0].exit.x)} ${formatPathNumber(corners[0].exit.y)}`,
    ];

    for (let index = 1; index < corners.length; index += 1) {
        const corner = corners[index];
        commands.push(`L ${formatPathNumber(corner.entry.x)} ${formatPathNumber(corner.entry.y)}`);
        commands.push(
            `Q ${formatPathNumber(corner.corner.x)} ${formatPathNumber(corner.corner.y)} ${formatPathNumber(corner.exit.x)} ${formatPathNumber(corner.exit.y)}`,
        );
    }

    const firstCorner = corners[0];
    commands.push(`L ${formatPathNumber(firstCorner.entry.x)} ${formatPathNumber(firstCorner.entry.y)}`);
    commands.push(
        `Q ${formatPathNumber(firstCorner.corner.x)} ${formatPathNumber(firstCorner.corner.y)} ${formatPathNumber(firstCorner.exit.x)} ${formatPathNumber(firstCorner.exit.y)}`,
    );
    commands.push("Z");
    return commands.join(" ");
};

export const traceRoundedPolygonPath = (
    context: CanvasRenderingContext2D,
    points: StickerPoint[],
    radius = 0,
) => {
    if (points.length < 3) return;

    if (radius <= 0) {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index += 1) {
            context.lineTo(points[index].x, points[index].y);
        }
        context.closePath();
        return;
    }

    const corners = buildRoundedCornerSpecs(points, radius);
    if (corners.length < 3) return;

    context.beginPath();
    context.moveTo(corners[0].exit.x, corners[0].exit.y);
    for (let index = 1; index < corners.length; index += 1) {
        const corner = corners[index];
        context.lineTo(corner.entry.x, corner.entry.y);
        context.quadraticCurveTo(corner.corner.x, corner.corner.y, corner.exit.x, corner.exit.y);
    }
    context.lineTo(corners[0].entry.x, corners[0].entry.y);
    context.quadraticCurveTo(
        corners[0].corner.x,
        corners[0].corner.y,
        corners[0].exit.x,
        corners[0].exit.y,
    );
    context.closePath();
};

// Convenience: vertices as an SVG `points` attribute string.
export const toSvgPoints = (points: StickerPoint[]): string =>
    points.map((p) => `${p.x},${p.y}`).join(" ");

export const getAnnotationBounds = (annotation: StickerAnnotation): AnnotationBounds => {
    switch (annotation.type) {
        case "rect":
        case "round-rect":
        case "ellipse":
        case "triangle":
        case "polygon":
            return getRotatedRectBounds(
                annotation.x,
                annotation.y,
                annotation.w,
                annotation.h,
                annotation.rotation,
            );
        case "mosaic":
        case "blur": {
            const pathBounds = getPointCloudBounds(
                annotation.points,
                Math.max(1, annotation.brushWidth ?? annotation.style.width ?? 0) / 2,
            );
            return pathBounds
                ? pathBounds
                : getRotatedRectBounds(
                      annotation.x,
                      annotation.y,
                      annotation.w,
                      annotation.h,
                      annotation.rotation,
                  );
        }
        case "serial": {
            const metrics = getTextAnnotationMetrics(annotation);
            return getRotatedRectBounds(
                metrics.left,
                metrics.top,
                metrics.width,
                metrics.height,
                annotation.rotation,
            );
        }
        case "text": {
            const metrics = getTextAnnotationMetrics(annotation);
            return getRotatedRectBounds(
                metrics.left,
                metrics.top,
                metrics.width,
                metrics.height,
                annotation.rotation,
            );
        }
        case "line":
        case "polyline":
        case "arrow":
        case "brush":
        case "highlighter": {
            if (annotation.points.length < 1) {
                return { x: 0, y: 0, w: 0, h: 0 };
            }

            const pad = Math.max(1, annotation.style.width) / 2;
            const xs = annotation.points.map((point) => point.x);
            const ys = annotation.points.map((point) => point.y);
            const minX = Math.min(...xs) - pad;
            const maxX = Math.max(...xs) + pad;
            const minY = Math.min(...ys) - pad;
            const maxY = Math.max(...ys) + pad;
            return {
                x: minX,
                y: minY,
                w: maxX - minX,
                h: maxY - minY,
            };
        }
        default:
            return { x: 0, y: 0, w: 0, h: 0 };
    }
};

export const getAnnotationCenter = (annotation: StickerAnnotation): StickerPoint => {
    if (
        annotation.type === "rect" ||
        annotation.type === "round-rect" ||
        annotation.type === "ellipse" ||
        annotation.type === "triangle" ||
        annotation.type === "polygon" ||
        annotation.type === "mosaic" ||
        annotation.type === "blur"
    ) {
        return {
            x: annotation.x + annotation.w / 2,
            y: annotation.y + annotation.h / 2,
        };
    }

    if (annotation.type === "text" || annotation.type === "serial") {
        const metrics = getTextAnnotationMetrics(annotation);
        return {
            x: metrics.left + metrics.width / 2,
            y: metrics.top + metrics.height / 2,
        };
    }

    const bounds = getAnnotationBounds(annotation);
    return {
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h / 2,
    };
};

export const getAnnotationGroupBounds = (annotations: StickerAnnotation[]): AnnotationBounds => {
    if (annotations.length === 0) {
        return { x: 0, y: 0, w: 0, h: 0 };
    }

    const bounds = annotations.map(getAnnotationBounds);
    const minX = Math.min(...bounds.map((bound) => bound.x));
    const minY = Math.min(...bounds.map((bound) => bound.y));
    const maxX = Math.max(...bounds.map((bound) => bound.x + bound.w));
    const maxY = Math.max(...bounds.map((bound) => bound.y + bound.h));
    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
    };
};

export const getAnnotationGroupCenter = (annotations: StickerAnnotation[]): StickerPoint => {
    if (annotations.length === 0) {
        return { x: 0, y: 0 };
    }

    const bounds = getAnnotationGroupBounds(annotations);
    return {
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h / 2,
    };
};

export const rotateAnnotationAroundCenter = (
    annotation: StickerAnnotation,
    angleDegrees: number,
): StickerAnnotation => rotateAnnotationAroundPivot(annotation, getAnnotationCenter(annotation), angleDegrees);

export const scaleAnnotationAroundCenter = (
    annotation: StickerAnnotation,
    scale: AnnotationScale,
): StickerAnnotation => scaleAnnotationAroundPivot(annotation, getAnnotationCenter(annotation), scale);

export const rotateAnnotationsAroundGroupCenter = (
    annotations: StickerAnnotation[],
    angleDegrees: number,
): StickerAnnotation[] => {
    const center = getAnnotationGroupCenter(annotations);
    return annotations.map((annotation) => rotateAnnotationAroundPivot(annotation, center, angleDegrees));
};

export const rotateAnnotationsAroundOwnCenters = (
    annotations: StickerAnnotation[],
    angleDegrees: number,
): StickerAnnotation[] =>
    annotations.map((annotation) => rotateAnnotationAroundCenter(annotation, angleDegrees));

export const scaleAnnotationsAroundGroupCenter = (
    annotations: StickerAnnotation[],
    scale: AnnotationScale,
): StickerAnnotation[] => {
    const center = getAnnotationGroupCenter(annotations);
    return annotations.map((annotation) => scaleAnnotationAroundPivot(annotation, center, scale));
};

export const scaleAnnotationsAroundOwnCenters = (
    annotations: StickerAnnotation[],
    scale: AnnotationScale,
): StickerAnnotation[] => annotations.map((annotation) => scaleAnnotationAroundCenter(annotation, scale));
