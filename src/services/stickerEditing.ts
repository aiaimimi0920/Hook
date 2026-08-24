/**
 * Stable sticker-editing facade.
 *
 * Editing helpers remain grouped by pure ownership while callers retain this
 * import path and its existing public surface.
 */
export {
    createDefaultStickerColorState,
    createDefaultStickerToolProfiles,
    createDefaultStickerToolSettings,
    createEmptyAnnotationState,
    createEmptyImageEditState,
    DEFAULT_STICKER_PALETTE,
    HIGHLIGHTER_LAYER_OPACITY,
    TRANSPARENT_STICKER_COLOR,
} from "./stickerEditingDefaults";

export {
    clampCropRectToStickerBounds,
    clampShapeRectToStickerBounds,
    computeNextCropFrame,
    computeRestoredCropFrame,
    constrainLinearToolEndpoint,
} from "./stickerEditingGeometry";

export {
    addStickerPaletteColor,
    adjustEffectStrength,
    adjustStickerOpacity,
    adjustStrokeWidth,
    adjustTextSize,
    buildSerialAnnotationMetrics,
    formatRgbColor,
    getEffectiveStickerColor,
    getStickerColorAlpha,
    isTransparentStickerColor,
    normalizeStickerPaletteColor,
    parseHexColor,
    removeStickerPaletteColor,
} from "./stickerStyleValues";

export {
    computeContainFitPlacement,
    computeCroppedStickerImageViewport,
    computeMinifiedStickerAnnotationViewport,
    computeMinifiedStickerViewport,
    computeMinifiedStickerWindow,
    computeRestoredMinifiedStickerWindow,
    computeStickerWheelResizeFrame,
    scaleStickerFrame,
} from "./stickerFrameGeometry";

export {
    createContentEraserStroke,
    createDefaultStickerGroup,
    nextSerialLabel,
    toggleStickerBorder,
} from "./stickerEditingModels";
