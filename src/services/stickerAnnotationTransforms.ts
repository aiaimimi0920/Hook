import type { StickerAnnotation, StickerPoint } from "../types/stickerEditing";
import { buildSerialAnnotationMetrics } from "./stickerEditing";
import { getAnnotationCenter, getAnnotationGroupCenter } from "./stickerAnnotationBounds";
import {
    getPointCloudBounds,
    normalizeRotation,
    rotatePointAround,
    scalePointAround,
    scaleStrokeWidth,
} from "./stickerGeometryMath";
import type { AnnotationScale } from "./stickerGeometryTypes";
import {
    DEFAULT_TEXT_FONT_SIZE,
    getTextAnnotationMetrics,
    measureTextWidth,
} from "./stickerTextGeometry";

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
                  y: nextCenter.y + metrics.height / 2,
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
            y: nextCenter.y + (fontSize ?? DEFAULT_TEXT_FONT_SIZE) / 2,
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

/** Rotates one annotation around its own visual center. */
export const rotateAnnotationAroundCenter = (
    annotation: StickerAnnotation,
    angleDegrees: number,
): StickerAnnotation => rotateAnnotationAroundPivot(annotation, getAnnotationCenter(annotation), angleDegrees);

/** Scales one annotation around its own visual center. */
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
