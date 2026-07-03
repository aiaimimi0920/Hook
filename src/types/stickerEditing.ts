export type StickerEditingDomain =
    | "existing"
    | "create"
    | "sticker";

export type StickerTransformMode =
    | "select"
    | "move"
    | "rotate"
    | "scale";

export type StickerCanvasTool =
    | "idle"
    | "crop"
    | "content-eraser";

export type StickerCreateTool =
    | "crop"
    | "shape-rect"
    | "shape-round-rect"
    | "shape-ellipse"
    | "shape-triangle"
    | "shape-polygon"
    | "line"
    | "polyline"
    | "arrow"
    | "text"
    | "brush"
    | "highlighter"
    | "serial"
    | "mosaic"
    | "blur"
    | "content-eraser"
    | "color-picker";

export type StickerToolMode = StickerTransformMode | StickerCreateTool | StickerCanvasTool;

export interface StickerColorState {
    activeColor: string;
    sampledColor?: string;
    sampledRgb?: { r: number; g: number; b: number };
    palette: string[];
}

export interface StickerToolProfileSettings {
    strokeWidth: number;
    textSize: number;
    shapeCornerRadius: number;
    shapeConstrainSquare: boolean;
    shapeSnapStep: number;
    shapeStrokeDashPattern: "solid" | "dash-1" | "dash-2";
    polygonSides: number;
    lineArrowEnabled: boolean;
    lineAngleSnap: boolean;
    brushHighlighterEnabled: boolean;
    effectBrushSize: number;
    blurStrength: number;
    mosaicSize: number;
    textFontFamily: string;
    serialRadius: number;
    serialFontFamily: string;
}

export type StickerToolProfileSettingKey = keyof StickerToolProfileSettings;
export type StickerCreateToolProfiles = Partial<
    Record<StickerCreateTool, Partial<StickerToolProfileSettings>>
>;

export interface StickerToolSettings {
    domain: StickerEditingDomain;
    mode: StickerToolMode;
    transformMode: StickerTransformMode;
    activeCanvasTool: StickerCanvasTool;
    activeTool: StickerCreateTool;
    toolProfiles: StickerCreateToolProfiles;
    strokeWidth: number;
    textSize: number;
    textColor: string;
    rectStrokeColor: string;
    rectFillColor: string;
    ellipseStrokeColor: string;
    ellipseFillColor: string;
    triangleStrokeColor: string;
    triangleFillColor: string;
    polygonStrokeColor: string;
    polygonFillColor: string;
    lineStrokeColor: string;
    shapeCornerRadius: number;
    shapeConstrainSquare: boolean;
    shapeSnapStep: number;
    shapeStrokeDashPattern: "solid" | "dash-1" | "dash-2";
    polygonSides: number;
    lineArrowEnabled: boolean;
    lineAngleSnap: boolean;
    brushColor: string;
    brushHighlighterEnabled: boolean;
    effectBorderColor: string;
    effectBorderWidth: number;
    mosaicColorA: string;
    mosaicColorB: string;
    serialForegroundColor: string;
    serialFillColor: string;
    serialRadius: number;
    blurStrength: number;
    mosaicSize: number;
    effectBrushSize: number;
    brushOpacity: number;
    contentEraserSize: number;
    contentEraserOnlyAnnotations: boolean;
    textFontFamily: string;
    serialFontFamily: string;
}

export interface StickerPoint {
    x: number;
    y: number;
}

export interface StickerStrokeStyle {
    color: string;
    width: number;
    opacity?: number;
    fill?: string;
    secondaryFill?: string;
    cornerRadius?: number;
    dashPattern?: "solid" | "dash-1" | "dash-2";
}

interface StickerAnnotationBase {
    id: string;
    type:
        | "rect"
        | "round-rect"
        | "ellipse"
        | "triangle"
        | "polygon"
        | "line"
        | "polyline"
        | "arrow"
        | "text"
        | "brush"
        | "highlighter"
        | "serial"
        | "mosaic"
        | "blur";
    zIndex: number;
}

export interface StickerShapeAnnotation extends StickerAnnotationBase {
    type: "rect" | "round-rect" | "ellipse" | "triangle" | "polygon";
    x: number;
    y: number;
    w: number;
    h: number;
    rotation?: number;
    style: StickerStrokeStyle;
    // Number of sides for polygon annotations; ignored by other shape types.
    sides?: number;
}

export interface StickerLineAnnotation extends StickerAnnotationBase {
    type: "line" | "polyline" | "arrow" | "brush" | "highlighter";
    points: StickerPoint[];
    style: StickerStrokeStyle;
}

export interface StickerTextAnnotation extends StickerAnnotationBase {
    type: "text" | "serial";
    x: number;
    y: number;
    text: string;
    fontSize?: number;
    fontFamily?: string;
    rotation?: number;
    style: StickerStrokeStyle;
}

export interface StickerEffectAnnotation extends StickerAnnotationBase {
    type: "mosaic" | "blur";
    // Bounding box of the brushed region. Used for the source-pixel projection,
    // hit testing, and translation. For brush-style effects it is derived from
    // the points + brushWidth; it is still stored so downstream code (export,
    // selection) can work without rescanning the points.
    x: number;
    y: number;
    w: number;
    h: number;
    rotation?: number;
    style: StickerStrokeStyle;
    strength?: number;
    // Brush-style effect path. When present, the effect masks the mosaic/blur to
    // a thick stroke swept along these points (width = brushWidth) instead of
    // filling the whole bounding rect.
    points?: StickerPoint[];
    brushWidth?: number;
}

export type StickerAnnotation =
    | StickerShapeAnnotation
    | StickerLineAnnotation
    | StickerTextAnnotation
    | StickerEffectAnnotation;

export interface StickerAnnotationState {
    elements: StickerAnnotation[];
    serialCounter: number;
}

export interface ContentEraserStroke {
    id: string;
    points: StickerPoint[];
    color: string;
    width: number;
    opacity: number;
}

export interface StickerBeautifyState {
    enabled: boolean;
    // Preset id from BEAUTIFY_BACKGROUNDS (gradient or solid). Resolved to a
    // concrete fill at render time so presets can evolve without migrating data.
    backgroundId: string;
    padding: number;
    cornerRadius: number;
    shadow: boolean;
}

export interface StickerImageEditState {
    contentEraseStrokes: ContentEraserStroke[];
    cropRect?: { x: number; y: number; w: number; h: number };
    sourceSize?: { w: number; h: number };
    rotation?: 0 | 90 | 180 | 270;
    flippedX?: boolean;
    flippedY?: boolean;
    borderWidth?: number;
    borderColor?: string;
    cornerRadius?: number;
    beautify?: StickerBeautifyState;
}

export interface StickerCaptureMeta {
    kind?: "region" | "long";
    sourceRect?: { x: number; y: number; w: number; h: number };
    scrollAxis?: "vertical" | "horizontal";
}

export interface StickerGroup {
    id: string;
    name: string;
    hidden?: boolean;
    locked?: boolean;
}
