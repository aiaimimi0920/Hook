import type { StickerPoint } from "../types/stickerEditing";
import type { AnnotationBounds, AnnotationScale } from "./stickerGeometryTypes";

/** Distance from a point to the closest location on a finite line segment. */
export const pointToSegmentDistance = (point: StickerPoint, start: StickerPoint, end: StickerPoint) => {
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

/** Odd-even polygon containment test used by shape and arrow hit testing. */
export const isPointInPolygon = (point: StickerPoint, vertices: StickerPoint[]) => {
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

export const scaleStrokeWidth = (width: number, scaleX: number, scaleY: number) =>
    width * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2);

/** Axis-aligned bounds for a point cloud, optionally expanded by padding. */
export const getPointCloudBounds = (
    points: StickerPoint[] | undefined,
    padding = 0,
): AnnotationBounds | null => {
    if (!points || points.length < 1) {
        return null;
    }

    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;
    for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
    }

    return {
        x: minX - padding,
        y: minY - padding,
        w: maxX - minX + padding * 2,
        h: maxY - minY + padding * 2,
    };
};

/** Combines two axis-aligned bounds without allocating coordinate arrays. */
export const unionAnnotationBounds = (
    left: AnnotationBounds,
    right: AnnotationBounds,
): AnnotationBounds => {
    const minX = Math.min(left.x, right.x);
    const minY = Math.min(left.y, right.y);
    const maxX = Math.max(left.x + left.w, right.x + right.w);
    const maxY = Math.max(left.y + left.h, right.y + right.h);
    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
    };
};

export const scalePointAround = (
    point: StickerPoint,
    pivot: StickerPoint,
    scale: AnnotationScale,
): StickerPoint => ({
    x: pivot.x + (point.x - pivot.x) * scale.x,
    y: pivot.y + (point.y - pivot.y) * scale.y,
});

export const rotatePointAround = (
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

export const normalizeRotation = (rotation: number | undefined, deltaDegrees = 0) => {
    const next = (rotation ?? 0) + deltaDegrees;
    if (!Number.isFinite(next)) return rotation;
    return next;
};

export const getRotatedRectBounds = (
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
