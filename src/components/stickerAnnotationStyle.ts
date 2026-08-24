import { getEffectiveStickerColor } from "../services/stickerEditing";
import { stickerColorState, stickerToolSettings } from "../store/uiStore";
import type { StickerCreateTool } from "../types/stickerEditing";
import {
    getVisibleFill,
    type DraftLine,
    type DraftShape,
} from "./stickerAnnotationModel";
import {
    sanitizeShapeCornerRadius,
    sanitizeStrokeWidth,
} from "./stickerAnnotationNumericSafety";
import { getShapeFillColorKey, getShapeStrokeColorKey } from "./stickerToolbarModel";

// Centralize tool-to-style resolution so commit and preview paths cannot drift.
export const getShapeCornerRadius = (mode?: DraftShape["mode"]) =>
    sanitizeShapeCornerRadius(
        mode === "shape-round-rect" && stickerToolSettings.shapeCornerRadius === 0
            ? 12
            : stickerToolSettings.shapeCornerRadius,
    );

export const getShapeStrokeColorForMode = (
    mode: DraftShape["mode"] | StickerCreateTool,
) => stickerToolSettings[getShapeStrokeColorKey(mode)];

export const getShapeFillColorForMode = (
    mode: DraftShape["mode"] | StickerCreateTool,
) => {
    const key = getShapeFillColorKey(mode);
    return key ? stickerToolSettings[key] : "transparent";
};

export const getDraftShapePreviewFill = (mode?: DraftShape["mode"]) =>
    mode === "crop" ? "none" : getVisibleFill(getShapeFillColorForMode(mode ?? "shape-rect"));

export const getDraftShapePreviewDashArray = (mode?: DraftShape["mode"]) =>
    mode === "crop" ? undefined : "4 2";

export const getDraftShapePreviewCornerRadius = (mode?: DraftShape["mode"]) =>
    mode === "crop" ? 0 : getShapeCornerRadius(mode);

export const getDraftShapePreviewStrokeWidth = (mode?: DraftShape["mode"]) =>
    mode === "crop" ? 4 : sanitizeStrokeWidth(stickerToolSettings.strokeWidth);

export const getLineStrokeColor = (mode: DraftLine["mode"]) =>
    mode === "line" || mode === "arrow"
        ? stickerToolSettings.lineStrokeColor
        : mode === "brush" || mode === "highlighter"
          ? stickerToolSettings.brushColor
          : getEffectiveStickerColor(stickerColorState);

export const isHighlighterLineMode = (mode: DraftLine["mode"]) =>
    mode === "highlighter" || (mode === "brush" && stickerToolSettings.brushHighlighterEnabled);
