/** Shared immutable values and fresh factories for sticker-editing sessions. */
import type {
    StickerAnnotationState,
    StickerColorState,
    StickerCreateToolProfiles,
    StickerImageEditState,
    StickerToolSettings,
} from "../types/stickerEditing";

export const TRANSPARENT_STICKER_COLOR = "transparent";

/** Shared opacity for the single composited highlighter wash. */
export const HIGHLIGHTER_LAYER_OPACITY = 0.35;

export const DEFAULT_STICKER_PALETTE = [
    TRANSPARENT_STICKER_COLOR,
    "#ffffff",
    "#000000",
    "#ef4444",
    "#f59e0b",
    "#eab308",
    "#22c55e",
    "#06b6d4",
    "#3b82f6",
    "#8b5cf6",
];

export const createDefaultStickerColorState = (): StickerColorState => ({
    activeColor: "#ef4444",
    palette: [...DEFAULT_STICKER_PALETTE],
});

export const createDefaultStickerToolProfiles = (): StickerCreateToolProfiles => ({
    "shape-rect": {
        strokeWidth: 3,
        shapeCornerRadius: 0,
        shapeConstrainSquare: false,
        shapeSnapStep: 0,
        shapeStrokeDashPattern: "solid",
    },
    "shape-round-rect": {
        strokeWidth: 3,
        shapeCornerRadius: 0,
        shapeConstrainSquare: false,
        shapeSnapStep: 0,
        shapeStrokeDashPattern: "solid",
    },
    "shape-ellipse": {
        strokeWidth: 3,
        shapeConstrainSquare: false,
        shapeSnapStep: 0,
        shapeStrokeDashPattern: "solid",
    },
    "shape-triangle": {
        strokeWidth: 3,
        shapeCornerRadius: 0,
        shapeConstrainSquare: false,
        shapeSnapStep: 0,
        shapeStrokeDashPattern: "solid",
    },
    "shape-polygon": {
        strokeWidth: 3,
        shapeCornerRadius: 0,
        shapeConstrainSquare: false,
        shapeSnapStep: 0,
        shapeStrokeDashPattern: "solid",
        polygonSides: 6,
    },
    line: {
        strokeWidth: 3,
        shapeStrokeDashPattern: "solid",
        lineArrowEnabled: false,
        lineAngleSnap: false,
    },
    polyline: {
        strokeWidth: 3,
        shapeStrokeDashPattern: "solid",
    },
    arrow: {
        strokeWidth: 3,
        shapeStrokeDashPattern: "solid",
        lineAngleSnap: false,
    },
    brush: {
        strokeWidth: 3,
        shapeSnapStep: 0,
        shapeStrokeDashPattern: "solid",
        brushHighlighterEnabled: false,
    },
    highlighter: {
        strokeWidth: 3,
        shapeSnapStep: 0,
        shapeStrokeDashPattern: "solid",
        brushHighlighterEnabled: true,
    },
    text: {
        textSize: 16,
        textFontFamily: "微软雅黑",
    },
    serial: {
        serialRadius: 14,
        serialFontFamily: "微软雅黑",
    },
    mosaic: {
        effectBrushSize: 28,
        mosaicSize: 12,
    },
    blur: {
        effectBrushSize: 28,
        blurStrength: 8,
    },
});

export const createDefaultStickerToolSettings = (): StickerToolSettings => ({
    domain: "existing",
    mode: "select",
    transformMode: "select",
    activeCanvasTool: "idle",
    activeTool: "shape-rect",
    toolProfiles: createDefaultStickerToolProfiles(),
    strokeWidth: 3,
    textSize: 16,
    textColor: "#ef4444",
    rectStrokeColor: "#ef4444",
    rectFillColor: TRANSPARENT_STICKER_COLOR,
    ellipseStrokeColor: "#ef4444",
    ellipseFillColor: TRANSPARENT_STICKER_COLOR,
    triangleStrokeColor: "#ef4444",
    triangleFillColor: TRANSPARENT_STICKER_COLOR,
    polygonStrokeColor: "#ef4444",
    polygonFillColor: TRANSPARENT_STICKER_COLOR,
    lineStrokeColor: "#ef4444",
    shapeCornerRadius: 0,
    shapeConstrainSquare: false,
    shapeSnapStep: 0,
    shapeStrokeDashPattern: "solid",
    polygonSides: 6,
    lineArrowEnabled: false,
    lineAngleSnap: false,
    brushColor: "#ef4444",
    brushHighlighterEnabled: false,
    effectBorderColor: "#ef4444",
    effectBorderWidth: 1,
    mosaicColorA: "#000000",
    mosaicColorB: "#ffffff",
    serialForegroundColor: "#ef4444",
    serialFillColor: "#000000",
    serialRadius: 14,
    blurStrength: 8,
    mosaicSize: 12,
    effectBrushSize: 28,
    brushOpacity: 1,
    contentEraserSize: 20,
    contentEraserOnlyAnnotations: false,
    textFontFamily: "微软雅黑",
    serialFontFamily: "微软雅黑",
});

export const createEmptyAnnotationState = (): StickerAnnotationState => ({
    elements: [],
    serialCounter: 1,
});

export const createEmptyImageEditState = (): StickerImageEditState => ({
    contentEraseStrokes: [],
});
