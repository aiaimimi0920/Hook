import type { StickerAnnotation, StickerPoint } from "../types/stickerEditing";
import { buildArrowHeadPolygon } from "./stickerArrowGeometry";
import {
    getPointCloudBounds,
    getRotatedRectBounds,
    unionAnnotationBounds,
} from "./stickerGeometryMath";
import type { AnnotationBounds } from "./stickerGeometryTypes";
import { getTextAnnotationMetrics } from "./stickerTextGeometry";

/** Visual bounds including rotation, brush padding and arrow heads. */
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
            const arrowHead = annotation.type === "arrow"
                ? buildArrowHeadPolygon(annotation.points, {
                      headLength: Math.max(24, annotation.style.width * 6),
                      headWidth: Math.max(16, annotation.style.width * 5),
                      minDistance: 2,
                  })
                : null;
            const pathBounds = getPointCloudBounds(annotation.points, pad);
            if (!pathBounds || !arrowHead) {
                return pathBounds ?? { x: 0, y: 0, w: 0, h: 0 };
            }
            const arrowHeadBounds = getPointCloudBounds(arrowHead, pad);
            return arrowHeadBounds
                ? unionAnnotationBounds(pathBounds, arrowHeadBounds)
                : pathBounds;
        }
        default:
            return { x: 0, y: 0, w: 0, h: 0 };
    }
};

/** Center used by per-node transforms; text coordinates are baseline-based. */
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

    let bounds = getAnnotationBounds(annotations[0]);
    for (let index = 1; index < annotations.length; index += 1) {
        bounds = unionAnnotationBounds(bounds, getAnnotationBounds(annotations[index]));
    }
    return bounds;
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
