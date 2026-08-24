/** Small sticker model constructors and immutable state transitions. */
import type {
    ContentEraserStroke,
    StickerAnnotationState,
    StickerGroup,
    StickerImageEditState,
} from "../types/stickerEditing";

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

/** Toggles the active-color border without mutating the image-edit state. */
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
