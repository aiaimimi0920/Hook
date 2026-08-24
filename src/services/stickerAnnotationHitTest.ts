import type { StickerAnnotation, StickerPoint } from "../types/stickerEditing";
import { buildArrowHeadPolygon, getArrowShaftPoints } from "./stickerArrowGeometry";
import { getAnnotationBounds } from "./stickerAnnotationBounds";
import {
    isPointInPolygon,
    pointToSegmentDistance,
    rotatePointAround,
} from "./stickerGeometryMath";
import {
    buildPolygonPoints,
    buildTrianglePoints,
    MIN_POLYGON_SIDES,
} from "./stickerShapeGeometry";
import { getTextAnnotationMetrics } from "./stickerTextGeometry";

const isPointNearSegments = (
    point: StickerPoint,
    points: StickerPoint[] | undefined,
    threshold: number,
    closed = false,
) => {
    if (!points || points.length < 1) return false;
    if (points.length === 1) {
        return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= threshold;
    }
    for (let index = 1; index < points.length; index += 1) {
        if (pointToSegmentDistance(point, points[index - 1], points[index]) <= threshold) {
            return true;
        }
    }
    return closed
        ? pointToSegmentDistance(point, points[points.length - 1], points[0]) <= threshold
        : false;
};

const hasVisibleFill = (fill: string | undefined) => {
    if (!fill) return false;
    const normalized = fill.trim().toLowerCase().replace(/\s+/g, "");
    if (!normalized || normalized === "none" || normalized === "transparent") return false;
    if (/^#[0-9a-f]{8}$/.test(normalized) && normalized.endsWith("00")) return false;
    if (/^(rgba|hsla)\([^)]*,0(?:\.0+)?\)$/.test(normalized)) return false;
    return true;
};

const inverseRotatePointInBox = (
    point: StickerPoint,
    box: { x: number; y: number; w: number; h: number; rotation?: number },
) => {
    const rotation = box.rotation ?? 0;
    if (!rotation) return point;
    return rotatePointAround(
        point,
        { x: box.x + box.w / 2, y: box.y + box.h / 2 },
        -rotation,
    );
};

const isPointInRect = (
    point: StickerPoint,
    rect: { x: number; y: number; w: number; h: number },
) =>
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h;

const isPointInRoundedRect = (
    point: StickerPoint,
    rect: { x: number; y: number; w: number; h: number },
    radius: number,
) => {
    if (!isPointInRect(point, rect)) return false;
    const safeRadius = Math.max(0, Math.min(radius, rect.w / 2, rect.h / 2));
    if (safeRadius <= 0) return true;
    const nearestX = Math.max(rect.x + safeRadius, Math.min(point.x, rect.x + rect.w - safeRadius));
    const nearestY = Math.max(rect.y + safeRadius, Math.min(point.y, rect.y + rect.h - safeRadius));
    return Math.hypot(point.x - nearestX, point.y - nearestY) <= safeRadius;
};

const isBoxFillOrStrokeHit = (
    point: StickerPoint,
    box: { x: number; y: number; w: number; h: number },
    threshold: number,
    filled: boolean,
    radius = 0,
) => {
    const contains = (candidate: StickerPoint, rect: typeof box, cornerRadius: number) =>
        cornerRadius > 0
            ? isPointInRoundedRect(candidate, rect, cornerRadius)
            : isPointInRect(candidate, rect);
    if (filled && contains(point, box, radius)) return true;

    const outer = {
        x: box.x - threshold,
        y: box.y - threshold,
        w: box.w + threshold * 2,
        h: box.h + threshold * 2,
    };
    if (!contains(point, outer, radius + threshold)) return false;
    const inner = {
        x: box.x + threshold,
        y: box.y + threshold,
        w: box.w - threshold * 2,
        h: box.h - threshold * 2,
    };
    return inner.w <= 0 || inner.h <= 0 || !contains(point, inner, Math.max(0, radius - threshold));
};

const isEllipseFillOrStrokeHit = (
    point: StickerPoint,
    box: { x: number; y: number; w: number; h: number },
    threshold: number,
    filled: boolean,
) => {
    const rx = box.w / 2;
    const ry = box.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const cx = box.x + rx;
    const cy = box.y + ry;
    const dx = point.x - cx;
    const dy = point.y - cy;
    const normalized = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    if (filled && normalized <= 1) return true;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return false;
    const cos = dx / distance;
    const sin = dy / distance;
    const edgeDistance = 1 / Math.sqrt((cos * cos) / (rx * rx) + (sin * sin) / (ry * ry));
    return Math.abs(distance - edgeDistance) <= threshold;
};

/** Tests an annotation's rendered shape rather than only its outer bounds. */
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

    if (!boundsContainsPoint(getAnnotationBounds(annotation))) {
        return false;
    }

    switch (annotation.type) {
        case "rect":
        case "round-rect": {
            const localPoint = inverseRotatePointInBox(point, annotation);
            return isBoxFillOrStrokeHit(
                localPoint,
                annotation,
                tolerance + Math.max(1, annotation.style.width) / 2,
                hasVisibleFill(annotation.style.fill),
                annotation.type === "round-rect" ? annotation.style.cornerRadius ?? 12 : 0,
            );
        }
        case "ellipse": {
            const localPoint = inverseRotatePointInBox(point, annotation);
            return isEllipseFillOrStrokeHit(
                localPoint,
                annotation,
                tolerance + Math.max(1, annotation.style.width) / 2,
                hasVisibleFill(annotation.style.fill),
            );
        }
        case "triangle":
        case "polygon": {
            const localPoint = inverseRotatePointInBox(point, annotation);
            const vertices = annotation.type === "triangle"
                ? buildTrianglePoints(annotation)
                : buildPolygonPoints(annotation, annotation.sides ?? MIN_POLYGON_SIDES);
            return (
                (hasVisibleFill(annotation.style.fill) && isPointInPolygon(localPoint, vertices)) ||
                isPointNearSegments(
                    localPoint,
                    vertices,
                    tolerance + Math.max(1, annotation.style.width) / 2,
                    true,
                )
            );
        }
        case "mosaic":
        case "blur": {
            const localPoint = inverseRotatePointInBox(point, annotation);
            if (annotation.points && annotation.points.length > 0) {
                const brushWidth = annotation.brushWidth ?? annotation.style.width ?? 20;
                return isPointNearSegments(
                    localPoint,
                    annotation.points,
                    Math.max(1, brushWidth) / 2 + tolerance,
                );
            }
            return isPointInRect(localPoint, annotation);
        }
        case "serial":
        case "text": {
            const metrics = getTextAnnotationMetrics(annotation);
            const localPoint = inverseRotatePointInBox(point, {
                x: metrics.left,
                y: metrics.top,
                w: metrics.width,
                h: metrics.height,
                rotation: annotation.rotation,
            });
            return isPointInRect(localPoint, {
                x: metrics.left - tolerance,
                y: metrics.top - tolerance,
                w: metrics.width + tolerance * 2,
                h: metrics.height + tolerance * 2,
            });
        }
        case "line":
        case "polyline":
        case "arrow":
        case "brush":
        case "highlighter": {
            const threshold = tolerance + Math.max(1, annotation.style.width) / 2;
            const shaftPoints = annotation.type === "arrow"
                ? getArrowShaftPoints(annotation.points, {
                      headLength: Math.max(24, annotation.style.width * 6),
                      minDistance: 2,
                  })
                : annotation.points;
            if (isPointNearSegments(point, shaftPoints, threshold)) {
                return true;
            }
            if (annotation.type === "arrow") {
                const arrowHead = buildArrowHeadPolygon(annotation.points, {
                    headLength: Math.max(24, annotation.style.width * 6),
                    headWidth: Math.max(16, annotation.style.width * 5),
                    minDistance: 2,
                });
                if (
                    arrowHead &&
                    (isPointInPolygon(point, arrowHead) ||
                        isPointNearSegments(point, arrowHead, tolerance, true))
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
    let topmost: StickerAnnotation | undefined;
    for (const annotation of annotations) {
        // Equal z-index values keep their original stable-order winner.
        if (
            (!topmost || annotation.zIndex > topmost.zIndex) &&
            annotationContainsPoint(annotation, point, tolerance)
        ) {
            topmost = annotation;
        }
    }
    return topmost;
};
