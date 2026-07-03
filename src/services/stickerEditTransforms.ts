import type {
    ContentEraserStroke,
    StickerAnnotation,
    StickerAnnotationState,
    StickerImageEditState,
    StickerTextAnnotation,
} from "../types/stickerEditing";
import type { Unit } from "../types/unit";
import { buildSerialAnnotationMetrics } from "./stickerEditing";
import { scaleStickerAnnotationState } from "./stickerEditPropagation";

type StickerFrame = Pick<Unit, "w" | "h">;
type FlipAxis = "x" | "y";

const getScale = (sourceFrame: StickerFrame, targetFrame: StickerFrame) => ({
    x: sourceFrame.w === 0 ? 1 : targetFrame.w / sourceFrame.w,
    y: sourceFrame.h === 0 ? 1 : targetFrame.h / sourceFrame.h,
});

const scaleStrokeWidth = (width: number, scaleX: number, scaleY: number) =>
    width * ((Math.abs(scaleX) + Math.abs(scaleY)) / 2);

const scaleContentEraserStroke = (
    stroke: ContentEraserStroke,
    scaleX: number,
    scaleY: number,
): ContentEraserStroke => ({
    ...stroke,
    points: stroke.points.map((point) => ({
        x: point.x * scaleX,
        y: point.y * scaleY,
    })),
    width: scaleStrokeWidth(stroke.width, scaleX, scaleY),
});

const DEFAULT_TEXT_FONT_SIZE = 18;
const DEFAULT_TEXT_WIDTH_FACTOR = 0.6;

const mirrorPoint = (
    point: { x: number; y: number },
    frame: StickerFrame,
    axis: FlipAxis,
) => ({
    x: axis === "x" ? frame.w - point.x : point.x,
    y: axis === "y" ? frame.h - point.y : point.y,
});

const measureAnnotationTextWidth = (annotation: StickerTextAnnotation, fontSize: number) => {
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (context) {
            context.font = `${annotation.type === "serial" ? "700" : "500"} ${fontSize}px "Segoe UI", sans-serif`;
            const width = context.measureText(annotation.text).width;
            if (Number.isFinite(width) && width > 0) {
                return width;
            }
        }
    }

    return Math.max(fontSize, annotation.text.length * fontSize * DEFAULT_TEXT_WIDTH_FACTOR);
};

const flipAnnotation = (
    annotation: StickerAnnotation,
    frame: StickerFrame,
    axis: FlipAxis,
): StickerAnnotation => {
    if (
        annotation.type === "rect" ||
        annotation.type === "round-rect" ||
        annotation.type === "ellipse" ||
        annotation.type === "triangle" ||
        annotation.type === "polygon"
    ) {
        return {
            ...annotation,
            x: axis === "x" ? frame.w - annotation.x - annotation.w : annotation.x,
            y: axis === "y" ? frame.h - annotation.y - annotation.h : annotation.y,
        };
    }

    if (annotation.type === "mosaic" || annotation.type === "blur") {
        return {
            ...annotation,
            x: axis === "x" ? frame.w - annotation.x - annotation.w : annotation.x,
            y: axis === "y" ? frame.h - annotation.y - annotation.h : annotation.y,
            points: annotation.points?.map((point) => mirrorPoint(point, frame, axis)),
        };
    }

    if (annotation.type === "text" || annotation.type === "serial") {
        const fontSize =
            annotation.fontSize ??
            (annotation.type === "serial"
                ? buildSerialAnnotationMetrics(annotation.style.cornerRadius ?? 14).fontSize
                : DEFAULT_TEXT_FONT_SIZE);

        if (annotation.type === "serial") {
            const serialMetrics = buildSerialAnnotationMetrics(annotation.style.cornerRadius ?? 14);
            return {
                ...annotation,
                x: axis === "x" ? frame.w - annotation.x - serialMetrics.radius * 2 : annotation.x,
                y: axis === "y" ? frame.h - annotation.y + fontSize : annotation.y,
            };
        }

        const textWidth = measureAnnotationTextWidth(annotation, fontSize);
        return {
            ...annotation,
            x: axis === "x" ? frame.w - annotation.x - textWidth : annotation.x,
            y: axis === "y" ? frame.h - annotation.y - fontSize : annotation.y,
        };
    }

    return annotation.type === "line" ||
        annotation.type === "polyline" ||
        annotation.type === "arrow" ||
        annotation.type === "brush" ||
        annotation.type === "highlighter"
        ? {
              ...annotation,
              points: annotation.points.map((point) => mirrorPoint(point, frame, axis)),
          }
        : annotation;
};

const flipContentEraserStroke = (
    stroke: ContentEraserStroke,
    frame: StickerFrame,
    axis: FlipAxis,
): ContentEraserStroke => ({
    ...stroke,
    points: stroke.points.map((point) => mirrorPoint(point, frame, axis)),
});

export const scaleStickerImageEditState = (
    state: StickerImageEditState | undefined,
    sourceFrame: StickerFrame,
    targetFrame: StickerFrame,
): StickerImageEditState | undefined => {
    if (!state) return undefined;

    const scale = getScale(sourceFrame, targetFrame);

    return {
        ...state,
        contentEraseStrokes: state.contentEraseStrokes.map((stroke) =>
            scaleContentEraserStroke(stroke, scale.x, scale.y),
        ),
        borderWidth:
            state.borderWidth === undefined
                ? undefined
                : scaleStrokeWidth(state.borderWidth, scale.x, scale.y),
        cornerRadius:
            state.cornerRadius === undefined
                ? undefined
                : scaleStrokeWidth(state.cornerRadius, scale.x, scale.y),
    };
};

export const flipStickerAnnotationStateForFrame = (
    state: StickerAnnotationState | undefined,
    frame: StickerFrame,
    axis: FlipAxis,
): StickerAnnotationState | undefined => {
    if (!state) return undefined;

    return {
        serialCounter: state.serialCounter,
        elements: state.elements.map((annotation) => flipAnnotation(annotation, frame, axis)),
    };
};

export const flipStickerImageEditStateForFrame = (
    state: StickerImageEditState | undefined,
    frame: StickerFrame,
    axis: FlipAxis,
): StickerImageEditState | undefined => {
    if (!state) return undefined;

    return {
        ...state,
        contentEraseStrokes: state.contentEraseStrokes.map((stroke) =>
            flipContentEraserStroke(stroke, frame, axis),
        ),
    };
};

export const scaleStickerEditDataForFrame = (
    data: Unit["data"],
    sourceFrame: StickerFrame,
    targetFrame: StickerFrame,
): Partial<Unit["data"]> => {
    const updates: Partial<Unit["data"]> = {};

    const annotationState = scaleStickerAnnotationState(
        data.annotationState,
        sourceFrame,
        targetFrame,
    );
    if (annotationState) {
        updates.annotationState = annotationState;
    }

    const imageEditState = scaleStickerImageEditState(
        data.imageEditState,
        sourceFrame,
        targetFrame,
    );
    if (imageEditState) {
        updates.imageEditState = imageEditState;
    }

    return updates;
};

export const flipStickerEditDataForFrame = (
    data: Unit["data"],
    frame: StickerFrame,
    axis: FlipAxis,
): Partial<Unit["data"]> => {
    const updates: Partial<Unit["data"]> = {};

    const annotationState = flipStickerAnnotationStateForFrame(data.annotationState, frame, axis);
    if (annotationState) {
        updates.annotationState = annotationState;
    }

    const imageEditState = flipStickerImageEditStateForFrame(data.imageEditState, frame, axis);
    if (imageEditState) {
        updates.imageEditState = imageEditState;
    }

    return updates;
};
