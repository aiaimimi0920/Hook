import type { ScreenColorSample } from "../services/api";
import { isTransparentStickerColor } from "../services/stickerEditing";
import type { StickerPoint, StickerShapeAnnotation } from "../types/stickerEditing";

export type TransformAxisMode = "xy" | "x" | "y";

interface TransformGizmoOptions {
    axisLength?: number;
    hitPadding?: number;
    centerSize?: number;
    handleSize?: number;
}

interface GizmoRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

const DEFAULT_TRANSFORM_GIZMO_AXIS_LENGTH = 44;
const DEFAULT_TRANSFORM_GIZMO_HIT_PADDING = 8;
const DEFAULT_TRANSFORM_GIZMO_CENTER_SIZE = 10;
const DEFAULT_TRANSFORM_GIZMO_SCALE_HANDLE_SIZE = 12;

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

const isPointInRect = (point: StickerPoint, rect: GizmoRect, padding = 0) =>
    point.x >= rect.x - padding &&
    point.x <= rect.x + rect.w + padding &&
    point.y >= rect.y - padding &&
    point.y <= rect.y + rect.h + padding;

const getCenterHandleRect = (center: StickerPoint, centerSize = DEFAULT_TRANSFORM_GIZMO_CENTER_SIZE): GizmoRect => ({
    x: center.x - centerSize / 2,
    y: center.y - centerSize / 2,
    w: centerSize,
    h: centerSize,
});

export const getScaleGizmoHandleRects = (
    center: StickerPoint,
    options: TransformGizmoOptions = {},
) => {
    const axisLength = options.axisLength ?? DEFAULT_TRANSFORM_GIZMO_AXIS_LENGTH;
    const centerSize = options.centerSize ?? DEFAULT_TRANSFORM_GIZMO_CENTER_SIZE;
    const handleSize = options.handleSize ?? DEFAULT_TRANSFORM_GIZMO_SCALE_HANDLE_SIZE;

    return {
        center: getCenterHandleRect(center, centerSize),
        x: {
            x: center.x + axisLength - handleSize / 2,
            y: center.y - handleSize / 2,
            w: handleSize,
            h: handleSize,
        },
        y: {
            x: center.x - handleSize / 2,
            y: center.y + axisLength - handleSize / 2,
            w: handleSize,
            h: handleSize,
        },
    };
};

export const resolveMoveGizmoAxisAtPoint = (
    point: StickerPoint,
    center: StickerPoint,
    options: TransformGizmoOptions = {},
): TransformAxisMode | null => {
    const axisLength = options.axisLength ?? DEFAULT_TRANSFORM_GIZMO_AXIS_LENGTH;
    const hitPadding = options.hitPadding ?? DEFAULT_TRANSFORM_GIZMO_HIT_PADDING;
    const centerRect = getCenterHandleRect(center, options.centerSize ?? DEFAULT_TRANSFORM_GIZMO_CENTER_SIZE);
    if (isPointInRect(point, centerRect, hitPadding)) {
        return "xy";
    }

    const onXAxis = pointToSegmentDistance(
        point,
        { x: center.x - axisLength, y: center.y },
        { x: center.x + axisLength, y: center.y },
    ) <= hitPadding;
    if (onXAxis) {
        return "x";
    }

    const onYAxis = pointToSegmentDistance(
        point,
        { x: center.x, y: center.y - axisLength },
        { x: center.x, y: center.y + axisLength },
    ) <= hitPadding;
    return onYAxis ? "y" : null;
};

export const resolveScaleGizmoAxisAtPoint = (
    point: StickerPoint,
    center: StickerPoint,
    options: TransformGizmoOptions = {},
): TransformAxisMode | null => {
    const axisLength = options.axisLength ?? DEFAULT_TRANSFORM_GIZMO_AXIS_LENGTH;
    const hitPadding = options.hitPadding ?? DEFAULT_TRANSFORM_GIZMO_HIT_PADDING;
    const handleRects = getScaleGizmoHandleRects(center, options);

    if (isPointInRect(point, handleRects.center, hitPadding)) {
        return "xy";
    }
    if (isPointInRect(point, handleRects.x, hitPadding)) {
        return "x";
    }
    if (isPointInRect(point, handleRects.y, hitPadding)) {
        return "y";
    }

    const onXAxis = pointToSegmentDistance(
        point,
        center,
        { x: handleRects.x.x + handleRects.x.w / 2, y: handleRects.x.y + handleRects.x.h / 2 },
    ) <= hitPadding;
    if (onXAxis) {
        return "x";
    }

    const onYAxis = pointToSegmentDistance(
        point,
        center,
        { x: handleRects.y.x + handleRects.y.w / 2, y: handleRects.y.y + handleRects.y.h / 2 },
    ) <= hitPadding;
    return onYAxis ? "y" : null;
};

export type DraftShape = {
    mode: "crop" | "shape-rect" | "shape-round-rect" | "shape-ellipse" | "shape-triangle" | "shape-polygon";
    start: StickerPoint;
    current: StickerPoint;
    constrainSquare?: boolean;
    snapStep?: number;
};

export type DraftLine = {
    mode: "line" | "polyline" | "arrow" | "brush" | "highlighter" | "content-eraser" | "mosaic" | "blur";
    points: StickerPoint[];
    showArrowHead?: boolean;
};

export type GlobalColorPickerMousePayload = {
    x?: number;
    y?: number;
    globalX?: number;
    globalY?: number;
    hex?: string;
    rgb?: ScreenColorSample["rgb"];
};

export type ColorPickerPreview = {
    x: number;
    y: number;
    hex: string;
    rgb: ScreenColorSample["rgb"];
};

export type PendingTextInput = {
    annotationId?: string;
    x: number;
    y: number;
    value: string;
    fontSize: number;
    color: string;
    fontFamily: string;
};

export const isBoundedBoxMode = (mode: DraftShape["mode"]) =>
    mode === "crop" ||
    mode === "shape-rect" ||
    mode === "shape-round-rect" ||
    mode === "shape-ellipse" ||
    mode === "shape-triangle" ||
    mode === "shape-polygon";

export const isRegularShapeMode = (mode: DraftShape["mode"]) =>
    mode === "shape-rect" || mode === "shape-round-rect" || mode === "shape-ellipse" || mode === "shape-triangle" || mode === "shape-polygon";

export const isStraightLineMode = (mode: DraftLine["mode"]) =>
    mode === "line" ||
    mode === "arrow" ||
    mode === "brush" ||
    mode === "highlighter";

export const isMeasuredLineMode = (mode: DraftLine["mode"]) =>
    mode === "line" || mode === "arrow";

// Render-order rank for sticker annotations. Censoring effects sit at the very
// bottom so painted annotations (text, arrows, shapes) stay visible above them.
// Among effects, blur renders below mosaic so a blur brush — which reveals a
// (pre-blurred) copy of the underlying image — can never paint over and erase a
// mosaic that censors the same pixels. Within a rank the original order is kept
// because Array.prototype.sort is stable.
export const annotationRenderRank = (type: string) =>
    type === "blur" ? 0 : type === "mosaic" ? 1 : 2;

export const getVisibleStroke = (color: string, width: number) =>
    width > 0 && !isTransparentStickerColor(color) ? color : "none";

export const getVisibleFill = (color: string | undefined) =>
    isTransparentStickerColor(color) ? "transparent" : color!;

export const getAnnotationCornerRadius = (shape: StickerShapeAnnotation) =>
    shape.style.cornerRadius ?? (shape.type === "round-rect" ? 12 : 0);

export const getStrokeDashArray = (dashPattern?: "solid" | "dash-1" | "dash-2") => {
    if (!dashPattern || dashPattern === "solid") return undefined;
    if (dashPattern === "dash-1") return "8 4";
    if (dashPattern === "dash-2") return "4 2 1 2";
    return undefined;
};

export const normalizeRect = (start: StickerPoint, end: StickerPoint) => ({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
});
