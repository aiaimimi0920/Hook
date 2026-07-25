import type { Component } from "solid-js";

import {
    BlurToolIcon,
    EllipseToolIcon,
    LineToolIcon,
    MosaicToolIcon,
    MoveModeIcon,
    PolygonToolIcon,
    RasterizeAllToolIcon,
    RasterizeSelectedToolIcon,
    RectToolIcon,
    RedoToolIcon,
    RotateModeIcon,
    ScaleModeIcon,
    SelectModeIcon,
    SerialToolIcon,
    TextToolIcon,
    TriangleToolIcon,
    UndoToolIcon,
    type TopStripIconProps,
} from "./stickerTopStripIcons";
import type { StickerRasterizeScope } from "../services/stickerRasterize";
import type { StickerCreateTool, StickerTransformMode } from "../types/stickerEditing";

export type ShapeCreateTool = Extract<
    StickerCreateTool,
    "shape-rect" | "shape-ellipse" | "shape-triangle" | "shape-polygon"
>;
export type LabelCreateTool = Extract<StickerCreateTool, "text" | "serial">;
export type EffectCreateTool = Extract<StickerCreateTool, "mosaic" | "blur">;
export type TopStripCreateTool = ShapeCreateTool | "line" | "brush" | LabelCreateTool | EffectCreateTool;
export type HistoryActionMode = "undo" | "redo";

export interface TransformModeOption {
    mode: StickerTransformMode;
    label: string;
    shortcut: string;
    Icon: Component<TopStripIconProps>;
}

export interface CreateToolOption<TMode extends StickerCreateTool> {
    mode: TMode;
    label: string;
    Icon: Component<TopStripIconProps>;
}

export interface HistoryActionOption {
    mode: HistoryActionMode;
    label: string;
    Icon: Component<TopStripIconProps>;
}

export interface RasterizeScopeOption {
    mode: StickerRasterizeScope;
    label: string;
    Icon: Component<TopStripIconProps>;
}

export const transformModeOptions: TransformModeOption[] = [
    { mode: "select", label: "选择", shortcut: "Q", Icon: SelectModeIcon },
    { mode: "move", label: "移动", shortcut: "W", Icon: MoveModeIcon },
    { mode: "rotate", label: "旋转", shortcut: "E", Icon: RotateModeIcon },
    { mode: "scale", label: "缩放", shortcut: "R", Icon: ScaleModeIcon },
];

export const shapeToolOptions: CreateToolOption<ShapeCreateTool>[] = [
    { mode: "shape-rect", label: "矩形", Icon: RectToolIcon },
    { mode: "shape-ellipse", label: "椭圆", Icon: EllipseToolIcon },
    { mode: "shape-triangle", label: "三角形", Icon: TriangleToolIcon },
    { mode: "shape-polygon", label: "多边形", Icon: PolygonToolIcon },
];

export const lineToolOptions: CreateToolOption<"line">[] = [
    { mode: "line", label: "直线", Icon: LineToolIcon },
];

export const labelToolOptions: CreateToolOption<LabelCreateTool>[] = [
    { mode: "text", label: "文本", Icon: TextToolIcon },
    { mode: "serial", label: "序号", Icon: SerialToolIcon },
];

export const effectToolOptions: CreateToolOption<EffectCreateTool>[] = [
    { mode: "mosaic", label: "马赛克", Icon: MosaicToolIcon },
    { mode: "blur", label: "模糊", Icon: BlurToolIcon },
];

export const historyActionOptions: HistoryActionOption[] = [
    { mode: "undo", label: "撤销", Icon: UndoToolIcon },
    { mode: "redo", label: "重做", Icon: RedoToolIcon },
];

export const rasterizeScopeOptions: RasterizeScopeOption[] = [
    { mode: "selected", label: "栅格化", Icon: RasterizeSelectedToolIcon },
    { mode: "all", label: "栅格化全部", Icon: RasterizeAllToolIcon },
];

export const isShapeTool = (value: StickerCreateTool): value is ShapeCreateTool =>
    value === "shape-rect" || value === "shape-ellipse" || value === "shape-triangle" || value === "shape-polygon";

export const isLabelTool = (value: StickerCreateTool): value is LabelCreateTool => value === "text" || value === "serial";

export const isEffectTool = (value: StickerCreateTool): value is EffectCreateTool => value === "mosaic" || value === "blur";
