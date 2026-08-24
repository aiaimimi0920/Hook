import { unwrap } from "solid-js/store";
import type { StickerAnnotation, StickerPoint } from "../types/stickerEditing";
import type { LineEndpointHandle, ResizeHandle } from "./stickerGeometryTypes";

/** Translates an annotation while preserving its concrete union member type. */
export const translateAnnotation = <T extends StickerAnnotation>(
    annotation: T,
    deltaX: number,
    deltaY: number,
): T => {
    switch (annotation.type) {
        case "mosaic":
        case "blur":
            return {
                ...annotation,
                x: annotation.x + deltaX,
                y: annotation.y + deltaY,
                // Brush-painted effects carry a stroke path; keep it in sync with the box.
                points: annotation.points
                    ? annotation.points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY }))
                    : annotation.points,
            };
        case "rect":
        case "round-rect":
        case "ellipse":
        case "triangle":
        case "polygon":
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

/** Produces a plain deep clone even when the source is a Solid store proxy. */
export const cloneStickerAnnotation = <T extends StickerAnnotation>(annotation: T): T =>
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

    // Brush effects carry a point mask that must scale with the editable box.
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

export const moveLineEndpoint = <T extends StickerAnnotation>(
    annotation: T,
    handle: LineEndpointHandle,
    point: StickerPoint,
): T => {
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
