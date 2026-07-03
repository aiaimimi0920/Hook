import type {
    StickerAnnotation,
    StickerCreateTool,
    StickerEditingDomain,
    StickerToolSettings,
    StickerTransformMode,
} from "../types/stickerEditing";

export type StickerCreateToolCategoryId = "shape" | "paint" | "label" | "effect";
export type StickerCanvasCategoryId = "geometry" | "erase" | "appearance" | "finalize";
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

export type StickerToolbarTool = { mode: StickerCreateTool; label: string };
export type StickerTransformModeButton = { mode: StickerTransformMode; label: string; shortcut: string };
export type StickerEditingDomainButton = { id: StickerEditingDomain; label: string; description: string };
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
export type ActiveColorPopoverSlot = { key: ShapeColorSettingKey; label: string };
export type StickerCreateToolCategory = {
    id: StickerCreateToolCategoryId;
    label: string;
    tools: StickerToolbarTool[];
};
export type StickerCanvasCategory = {
    id: StickerCanvasCategoryId;
    label: string;
    description: string;
};

export const STICKER_EDITING_DOMAINS: StickerEditingDomainButton[] = [
    { id: "existing", label: "已有节点", description: "选择并修改已经存在的标记节点" },
    { id: "create", label: "新建节点", description: "创建新的图形、文字、绘画与效果节点" },
    { id: "sticker", label: "整图处理", description: "直接处理整张贴图的几何、外观与擦除" },
];

export const TRANSFORM_MODE_BUTTONS: StickerTransformModeButton[] = [
    { mode: "select", label: "选择", shortcut: "Q" },
    { mode: "move", label: "移动", shortcut: "W" },
    { mode: "rotate", label: "旋转", shortcut: "E" },
    { mode: "scale", label: "缩放", shortcut: "R" },
];

export const CREATE_TOOL_CATEGORIES: StickerCreateToolCategory[] = [
    {
        id: "shape",
        label: "图形",
        tools: [
            { mode: "shape-rect", label: "矩形" },
            { mode: "shape-ellipse", label: "椭圆" },
            { mode: "shape-triangle", label: "三角形" },
            { mode: "shape-polygon", label: "多边形" },
            { mode: "line", label: "直线" },
        ],
    },
    {
        id: "paint",
        label: "绘画",
        tools: [
            { mode: "brush", label: "画笔" },
        ],
    },
    {
        id: "label",
        label: "文字标记",
        tools: [
            { mode: "text", label: "文本" },
            { mode: "serial", label: "序号" },
        ],
    },
    {
        id: "effect",
        label: "效果",
        tools: [
            { mode: "mosaic", label: "马赛克" },
            { mode: "blur", label: "模糊" },
        ],
    },
];

export const STICKER_CANVAS_CATEGORIES: StickerCanvasCategory[] = [
    { id: "geometry", label: "几何", description: "裁剪与翻转整张贴图" },
    { id: "erase", label: "擦除", description: "直接擦除贴图内容或栅格化标记图层" },
    { id: "appearance", label: "外观", description: "边框、圆角、透明度与画布尺寸" },
    { id: "finalize", label: "固化", description: "栅格化、撤销与重做" },
];

export const createCategoryForMode = (mode: StickerCreateTool): StickerCreateToolCategoryId =>
    mode === "shape-round-rect" || mode === "arrow" || mode === "polyline"
        ? "shape"
        : CREATE_TOOL_CATEGORIES.find((category) => category.tools.some((tool) => tool.mode === mode))?.id ?? "shape";

export const toolLabelForMode = (mode: StickerCreateTool | null) =>
    mode === "shape-round-rect"
        ? "圆角矩形"
        : mode === "arrow"
          ? "箭头"
          : CREATE_TOOL_CATEGORIES.flatMap((category) => category.tools).find((tool) => tool.mode === mode)?.label;

export const isShapeFillMode = (mode: StickerCreateTool | null) =>
    mode === "shape-rect" || mode === "shape-round-rect" || mode === "shape-ellipse" || mode === "shape-triangle" || mode === "shape-polygon";

export const isShapeStrokeMode = (mode: StickerCreateTool | null) =>
    isShapeFillMode(mode) || mode === "line" || mode === "arrow";

export const isBrushStrokeMode = (mode: StickerCreateTool | null) =>
    mode === "brush" || mode === "highlighter";

export const adjustToolSize = (current: number, delta: number, min = 4, max = 96) =>
    Math.min(max, Math.max(min, current + delta));

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
