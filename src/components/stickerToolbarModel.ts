import type {
    StickerAnnotation,
    StickerCreateTool,
    StickerEditingDomain,
    StickerToolSettings,
    StickerTransformMode,
} from "../types/stickerEditing";

export type StickerTopStripPropertyTool =
    | "crop"
    | "selected-text"
    | "selected-serial"
    | "shape-rect"
    | "shape-round-rect"
    | "shape-ellipse"
    | "shape-triangle"
    | "shape-polygon"
    | "line"
    | "arrow"
    | "brush"
    | "highlighter"
    | "text"
    | "serial"
    | "mosaic"
    | "blur"
    | "content-eraser";

export type StickerTransformModeButton = { mode: StickerTransformMode; label: string; shortcut: string };
export type ShapeColorSettingKey = keyof Pick<
    StickerToolSettings,
    | "textColor"
    | "rectStrokeColor"
    | "rectFillColor"
    | "ellipseStrokeColor"
    | "ellipseFillColor"
    | "triangleStrokeColor"
    | "triangleFillColor"
    | "polygonStrokeColor"
    | "polygonFillColor"
    | "lineStrokeColor"
    | "brushColor"
    | "effectBorderColor"
    | "mosaicColorA"
    | "mosaicColorB"
    | "serialForegroundColor"
    | "serialFillColor"
>;
export type NumericToolSettingKey = keyof Pick<
    StickerToolSettings,
    | "strokeWidth"
    | "shapeCornerRadius"
    | "shapeSnapStep"
    | "polygonSides"
    | "effectBorderWidth"
    | "serialRadius"
    | "textSize"
    | "blurStrength"
    | "mosaicSize"
    | "effectBrushSize"
    | "contentEraserSize"
>;
export const TRANSFORM_MODE_BUTTONS: StickerTransformModeButton[] = [
    { mode: "select", label: "选择", shortcut: "Q" },
    { mode: "move", label: "移动", shortcut: "W" },
    { mode: "rotate", label: "旋转", shortcut: "E" },
    { mode: "scale", label: "缩放", shortcut: "R" },
];

export const PAINT_COLOR_SETTING_KEYS: ShapeColorSettingKey[] = [
    "textColor",
    "rectStrokeColor",
    "rectFillColor",
    "ellipseStrokeColor",
    "ellipseFillColor",
    "triangleStrokeColor",
    "triangleFillColor",
    "polygonStrokeColor",
    "polygonFillColor",
    "lineStrokeColor",
    "brushColor",
    "effectBorderColor",
    "mosaicColorA",
    "mosaicColorB",
    "serialForegroundColor",
    "serialFillColor",
];

const SHAPE_FILL_COLOR_KEYS: ShapeColorSettingKey[] = [
    "rectFillColor",
    "ellipseFillColor",
    "triangleFillColor",
    "polygonFillColor",
];

export const getResetColorForSlot = (key: ShapeColorSettingKey) => {
    if (SHAPE_FILL_COLOR_KEYS.includes(key)) return "transparent";
    if (key === "mosaicColorA") return "#000000";
    if (key === "mosaicColorB") return "#ffffff";
    if (key === "serialFillColor") return "#000000";
    return "#ef4444";
};

export const getShapeStrokeColorKey = (mode: StickerCreateTool | null): ShapeColorSettingKey => {
    if (mode === "shape-ellipse") return "ellipseStrokeColor";
    if (mode === "shape-triangle") return "triangleStrokeColor";
    if (mode === "shape-polygon") return "polygonStrokeColor";
    if (mode === "line" || mode === "arrow") return "lineStrokeColor";
    return "rectStrokeColor";
};

export const getShapeFillColorKey = (mode: StickerCreateTool | null): ShapeColorSettingKey | null => {
    if (mode === "shape-ellipse") return "ellipseFillColor";
    if (mode === "shape-triangle") return "triangleFillColor";
    if (mode === "shape-polygon") return "polygonFillColor";
    if (mode === "line" || mode === "arrow") return null;
    if (mode === "shape-rect" || mode === "shape-round-rect") return "rectFillColor";
    return null;
};

export const resolveStickerTopStripPropertyTool = (
    domain: StickerEditingDomain,
    activeTool: StickerCreateTool,
    activeCanvasTool: StickerToolSettings["activeCanvasTool"],
): StickerTopStripPropertyTool | null => {
    if (domain === "sticker") {
        if (activeCanvasTool === "crop") return "crop";
        return activeCanvasTool === "content-eraser" ? "content-eraser" : null;
    }

    if (domain !== "create") return null;

    switch (activeTool) {
        case "shape-rect":
        case "shape-round-rect":
        case "shape-ellipse":
        case "shape-triangle":
        case "shape-polygon":
        case "line":
        case "arrow":
        case "brush":
        case "highlighter":
        case "text":
        case "serial":
        case "mosaic":
        case "blur":
            return activeTool;
        default:
            return null;
    }
};

export const resolveSelectedExistingNodePropertyTool = (
    domain: StickerEditingDomain,
    selectedAnnotationType: StickerAnnotation["type"] | null,
    selectionCount: number,
): StickerTopStripPropertyTool | null => {
    if (domain !== "existing" || selectionCount !== 1) return null;
    if (selectedAnnotationType === "text") return "selected-text";
    if (selectedAnnotationType === "serial") return "selected-serial";
    return null;
};
