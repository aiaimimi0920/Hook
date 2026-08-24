import {
    buildArrowHeadPolygon,
    getAnnotationCenter,
    getArrowShaftPoints,
} from "../services/stickerGeometry";
import type {
    StickerAnnotation,
    StickerEffectAnnotation,
    StickerPoint,
    StickerShapeAnnotation,
    StickerTextAnnotation,
} from "../types/stickerEditing";
import { sanitizeRotation } from "./stickerAnnotationNumericSafety";

export const renderLinePath = (points: StickerPoint[]) =>
    points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

export const renderArrowShaftPath = (
    points: StickerPoint[],
    strokeWidth: number,
    trimForArrow: boolean,
) => renderLinePath(
    trimForArrow
        ? getArrowShaftPoints(points, {
              headLength: Math.max(24, strokeWidth * 6),
              minDistance: 2,
          })
        : points,
);

export const renderArrowHeadPath = (points: StickerPoint[]) =>
    points.length === 3
        ? `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y} L ${points[2].x} ${points[2].y} Z`
        : "";

export const buildAnnotationRotationTransform = (
    annotation: StickerAnnotation | StickerTextAnnotation | StickerShapeAnnotation | StickerEffectAnnotation,
) => {
    if (!("rotation" in annotation)) return undefined;
    const rotation = sanitizeRotation(annotation.rotation);
    if (!rotation) return undefined;
    const center = getAnnotationCenter(annotation);
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return undefined;
    return `rotate(${rotation} ${center.x} ${center.y})`;
};

export const resolveArrowHead = (
    points: StickerPoint[],
    strokeWidth: number,
    force = false,
) => force
    ? buildArrowHeadPolygon(points, {
          headLength: Math.max(24, strokeWidth * 6),
          headWidth: Math.max(16, strokeWidth * 5),
          minDistance: 2,
      })
    : null;
