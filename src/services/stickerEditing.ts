import type {
    ContentEraserStroke,
    StickerAnnotationState,
    StickerColorState,
    StickerCreateToolProfiles,
    StickerGroup,
    StickerImageEditState,
    StickerPoint,
    StickerToolSettings,
} from "../types/stickerEditing";

export const TRANSPARENT_STICKER_COLOR = "transparent";

// Highlighter strokes render as a single translucent wash. The opacity is
// applied once at the layer level (one <g>/offscreen composite) rather than
// per stroke, so overlapping highlighter strokes do not compound into a
// darker patch. Both the live SVG layer and the canvas export share this.
// Within the wash each stroke is painted as a flat, fully-opaque solid color,
// so same-color overlaps never darken and a different color cleanly replaces
// the area it covers.
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

const clampPointToStickerBounds = (
    point: StickerPoint,
    bounds: { w: number; h: number },
): StickerPoint => ({
    x: Math.min(Math.max(point.x, 0), bounds.w),
    y: Math.min(Math.max(point.y, 0), bounds.h),
});

export const clampCropRectToStickerBounds = (
    start: StickerPoint,
    current: StickerPoint,
    bounds: { w: number; h: number },
) => {
    const safeStart = clampPointToStickerBounds(start, bounds);
    const safeCurrent = clampPointToStickerBounds(current, bounds);
    return {
        x: Math.min(safeStart.x, safeCurrent.x),
        y: Math.min(safeStart.y, safeCurrent.y),
        w: Math.abs(safeCurrent.x - safeStart.x),
        h: Math.abs(safeCurrent.y - safeStart.y),
    };
};

export const clampShapeRectToStickerBounds = (
    start: StickerPoint,
    current: StickerPoint,
    bounds: { w: number; h: number },
    lockAspect = false,
    snapStep?: number,
) => {
    const quantizeMagnitude = (value: number, max: number) => {
        if (!snapStep) {
            return Math.min(value, max);
        }
        const snapped = Math.round(value / snapStep) * snapStep;
        return Math.min(snapped, max);
    };

    if (!lockAspect) {
        const safeStart = clampPointToStickerBounds(start, bounds);
        const safeCurrent = clampPointToStickerBounds(current, bounds);
        const deltaX = safeCurrent.x - safeStart.x;
        const deltaY = safeCurrent.y - safeStart.y;
        const directionX = deltaX >= 0 ? 1 : -1;
        const directionY = deltaY >= 0 ? 1 : -1;
        const availableX = directionX > 0 ? bounds.w - safeStart.x : safeStart.x;
        const availableY = directionY > 0 ? bounds.h - safeStart.y : safeStart.y;
        const width = quantizeMagnitude(Math.abs(deltaX), availableX);
        const height = quantizeMagnitude(Math.abs(deltaY), availableY);
        const constrainedCurrent = {
            x: safeStart.x + directionX * width,
            y: safeStart.y + directionY * height,
        };

        return {
            x: Math.min(safeStart.x, constrainedCurrent.x),
            y: Math.min(safeStart.y, constrainedCurrent.y),
            w: Math.abs(constrainedCurrent.x - safeStart.x),
            h: Math.abs(constrainedCurrent.y - safeStart.y),
        };
    }

    const safeStart = clampPointToStickerBounds(start, bounds);
    const deltaX = current.x - safeStart.x;
    const deltaY = current.y - safeStart.y;
    const directionX = deltaX >= 0 ? 1 : -1;
    const directionY = deltaY >= 0 ? 1 : -1;
    const availableX = directionX > 0 ? bounds.w - safeStart.x : safeStart.x;
    const availableY = directionY > 0 ? bounds.h - safeStart.y : safeStart.y;
    const requestedSide = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    const side = quantizeMagnitude(requestedSide, Math.min(availableX, availableY));
    const constrainedCurrent = {
        x: safeStart.x + directionX * side,
        y: safeStart.y + directionY * side,
    };

    return {
        x: Math.min(safeStart.x, constrainedCurrent.x),
        y: Math.min(safeStart.y, constrainedCurrent.y),
        w: Math.abs(constrainedCurrent.x - safeStart.x),
        h: Math.abs(constrainedCurrent.y - safeStart.y),
    };
};

export const constrainLinearToolEndpoint = (
    start: StickerPoint,
    current: StickerPoint,
    options?: {
        lockAngle?: boolean;
        snapStep?: number;
        // Angle increment (in degrees) used when lockAngle is set. Defaults to 45°
        // to preserve the historic Shift behavior. The line tool's "正" toggle passes
        // 5 so users can draw 5°/10°/… angled segments.
        angleStepDegrees?: number;
    },
) => {
    let dx = current.x - start.x;
    let dy = current.y - start.y;

    if (options?.lockAngle) {
        const angleStep = ((options.angleStepDegrees ?? 45) * Math.PI) / 180;
        const angle = Math.atan2(dy, dx);
        const snappedAngle = Math.round(angle / angleStep) * angleStep;
        const length = Math.hypot(dx, dy);
        dx = Math.cos(snappedAngle) * length;
        dy = Math.sin(snappedAngle) * length;
    }

    if (options?.snapStep) {
        const step = options.snapStep;
        dx = Math.round(dx / step) * step;
        dy = Math.round(dy / step) * step;
    }

    return {
        x: start.x + dx,
        y: start.y + dy,
    };
};

export const computeNextCropFrame = (
    unitRect: { x: number; y: number; w: number; h: number },
    existingImageEditState: Pick<StickerImageEditState, "cropRect" | "sourceSize"> | undefined,
    cropRect: { x: number; y: number; w: number; h: number },
) => {
    const baseCrop = existingImageEditState?.cropRect || {
        x: 0,
        y: 0,
        w: unitRect.w,
        h: unitRect.h,
    };
    const sourceSize = existingImageEditState?.sourceSize || {
        w: unitRect.w,
        h: unitRect.h,
    };

    return {
        unitRect: {
            x: unitRect.x + cropRect.x,
            y: unitRect.y + cropRect.y,
            w: cropRect.w,
            h: cropRect.h,
        },
        cropRect: {
            x: baseCrop.x + cropRect.x,
            y: baseCrop.y + cropRect.y,
            w: cropRect.w,
            h: cropRect.h,
        },
        sourceSize,
    };
};

export const computeRestoredCropFrame = (
    unitRect: { x: number; y: number; w: number; h: number },
    existingImageEditState: Pick<StickerImageEditState, "cropRect" | "sourceSize"> | undefined,
) => {
    const cropRect = existingImageEditState?.cropRect;
    const sourceSize = existingImageEditState?.sourceSize;
    if (!cropRect || !sourceSize) {
        return unitRect;
    }

    return {
        x: unitRect.x - cropRect.x,
        y: unitRect.y - cropRect.y,
        w: sourceSize.w,
        h: sourceSize.h,
    };
};

export const getEffectiveStickerColor = (colors: StickerColorState, preferSampled = false) =>
    preferSampled && colors.sampledColor ? colors.sampledColor : colors.activeColor;

// Return the alpha (0-1) encoded in a sticker color, or 1 when none is present.
// Supports the literal "transparent" (=0), 8-digit #RRGGBBAA, and treats 3/6-digit
// hex (and any other opaque value) as fully opaque.
export const getStickerColorAlpha = (color: string | undefined): number => {
    if (!color) return 0;
    const trimmed = color.trim().toLowerCase();
    if (trimmed === TRANSPARENT_STICKER_COLOR) return 0;
    const hex = trimmed.replace(/^#/, "");
    if (/^[0-9a-f]{8}$/.test(hex)) {
        return parseInt(hex.slice(6, 8), 16) / 255;
    }
    return 1;
};

export const isTransparentStickerColor = (color: string | undefined) =>
    !color ||
    color.trim().toLowerCase() === TRANSPARENT_STICKER_COLOR ||
    getStickerColorAlpha(color) === 0;

export const normalizeStickerPaletteColor = (color: string) => {
    const trimmed = color.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === TRANSPARENT_STICKER_COLOR) {
        return TRANSPARENT_STICKER_COLOR;
    }

    const normalized = trimmed.replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
        return `#${normalized
            .split("")
            .map((part) => `${part}${part}`)
            .join("")
            .toLowerCase()}`;
    }
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return `#${normalized.toLowerCase()}`;
    }
    if (/^[0-9a-fA-F]{8}$/.test(normalized)) {
        const hex = normalized.toLowerCase();
        // Convert fully transparent hex colors to "transparent" string
        const alpha = parseInt(hex.slice(6, 8), 16);
        if (alpha === 0) {
            return TRANSPARENT_STICKER_COLOR;
        }
        return `#${hex}`;
    }
    return null;
};

export const addStickerPaletteColor = (palette: string[], color: string) => {
    const normalized = normalizeStickerPaletteColor(color);
    if (!normalized || palette.includes(normalized)) {
        return palette;
    }
    return [...palette, normalized];
};

export const removeStickerPaletteColor = (palette: string[], color: string) => {
    const normalized = normalizeStickerPaletteColor(color);
    if (!normalized) {
        return palette;
    }
    return palette.filter((item) => item !== normalized);
};

export const parseHexColor = (hex: string): { r: number; g: number; b: number } | undefined => {
    const normalized = hex.trim().replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(normalized) && !/^[0-9a-fA-F]{8}$/.test(normalized)) {
        return undefined;
    }

    return {
        r: Number.parseInt(normalized.slice(0, 2), 16),
        g: Number.parseInt(normalized.slice(2, 4), 16),
        b: Number.parseInt(normalized.slice(4, 6), 16),
    };
};

export const formatRgbColor = (rgb: { r: number; g: number; b: number }) =>
    `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

export const adjustStickerOpacity = (current: number, delta: number, min = 0, max = 1) => {
    const next = Math.min(max, Math.max(min, current + delta));
    return Math.round(next * 10) / 10;
};

export const adjustStrokeWidth = (current: number, delta: number, min = 0, max = 16) =>
    Math.min(max, Math.max(min, current + delta));

export const adjustTextSize = (current: number, delta: number, min = 10, max = 48) =>
    Math.min(max, Math.max(min, current + delta));

export const adjustEffectStrength = (current: number, delta: number, min = 2, max = 64) =>
    Math.min(max, Math.max(min, current + delta));

export const buildSerialAnnotationMetrics = (radius: number) => {
    const safeRadius = Math.min(96, Math.max(8, Math.round(radius)));
    return {
        radius: safeRadius,
        fontSize: Math.max(10, Math.round(safeRadius * 1.15)),
        borderWidth: Math.max(1, Math.round(safeRadius / 7)),
    };
};

export const scaleStickerFrame = (
    frame: { x: number; y: number; w: number; h: number },
    factor: number,
    minSize = 16,
) => {
    const centerX = frame.x + frame.w / 2;
    const centerY = frame.y + frame.h / 2;
    const nextW = Math.max(minSize, Math.round(frame.w * factor));
    const nextH = Math.max(minSize, Math.round(frame.h * factor));
    return {
        x: Math.round(centerX - nextW / 2),
        y: Math.round(centerY - nextH / 2),
        w: nextW,
        h: nextH,
    };
};

export const computeMinifiedStickerWindow = (
    frame: { x: number; y: number; w: number; h: number },
    relX: number,
    relY: number,
    cropSize = 100,
) => {
    const clampedRelX = Math.min(Math.max(relX, 0), 1);
    const clampedRelY = Math.min(Math.max(relY, 0), 1);
    const clickUnitX = clampedRelX * frame.w;
    const clickUnitY = clampedRelY * frame.h;
    const offsetX = clickUnitX - cropSize / 2;
    const offsetY = clickUnitY - cropSize / 2;

    return {
        savedRect: { ...frame },
        cropOffset: { x: offsetX, y: offsetY },
        frame: {
            x: frame.x + offsetX,
            y: frame.y + offsetY,
            w: cropSize,
            h: cropSize,
        },
    };
};

export const computeRestoredMinifiedStickerWindow = (
    currentMiniFrame: { x: number; y: number; w: number; h: number },
    savedRect: { x: number; y: number; w: number; h: number },
    cropOffset?: { x: number; y: number },
) => {
    if (!cropOffset) {
        return { ...savedRect };
    }

    return {
        x: currentMiniFrame.x - cropOffset.x,
        y: currentMiniFrame.y - cropOffset.y,
        w: savedRect.w,
        h: savedRect.h,
    };
};

export const computeMinifiedStickerViewport = (
    savedRect: { w: number; h: number } | undefined,
    cropOffset: { x: number; y: number } | undefined,
    imageEditState: Pick<StickerImageEditState, "cropRect" | "sourceSize"> | undefined,
) => {
    const baseOffsetX = cropOffset?.x ?? 0;
    const baseOffsetY = cropOffset?.y ?? 0;
    const cropRect = imageEditState?.cropRect;
    const sourceSize = imageEditState?.sourceSize;

    if (cropRect && sourceSize) {
        return {
            width: sourceSize.w,
            height: sourceSize.h,
            offsetX: cropRect.x + baseOffsetX,
            offsetY: cropRect.y + baseOffsetY,
        };
    }

    return {
        width: savedRect?.w ?? 100,
        height: savedRect?.h ?? 100,
        offsetX: baseOffsetX,
        offsetY: baseOffsetY,
    };
};

export const computeMinifiedStickerAnnotationViewport = (
    currentMiniFrame: { w: number; h: number },
    savedRect: { w: number; h: number } | undefined,
    cropOffset: { x: number; y: number } | undefined,
) => ({
    width: savedRect?.w ?? currentMiniFrame.w,
    height: savedRect?.h ?? currentMiniFrame.h,
    offsetX: cropOffset?.x ?? 0,
    offsetY: cropOffset?.y ?? 0,
});

export const createContentEraserStroke = (
    id: string,
    color: string,
    width: number,
    opacity: number,
): ContentEraserStroke => ({
    id,
    color,
    width,
    opacity,
    points: [],
});

export const nextSerialLabel = (annotationState: StickerAnnotationState) =>
    String(Math.max(1, annotationState.serialCounter));

export const createDefaultStickerGroup = (id: string, name: string): StickerGroup => ({
    id,
    name,
    hidden: false,
    locked: false,
});

export const toggleStickerBorder = (
    imageEditState: StickerImageEditState,
    activeColor: string,
    defaultWidth = 4,
): StickerImageEditState => {
    const borderWidth = imageEditState.borderWidth ?? 0;
    const borderColor = imageEditState.borderColor;

    if (borderWidth > 0 && borderColor === activeColor) {
        return {
            ...imageEditState,
            borderWidth: 0,
            borderColor: undefined,
        };
    }

    return {
        ...imageEditState,
        borderWidth: borderWidth > 0 ? borderWidth : defaultWidth,
        borderColor: activeColor,
    };
};
