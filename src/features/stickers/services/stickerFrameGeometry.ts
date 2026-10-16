/** Whole-sticker frame, resize, minified-window and viewport calculations. */
import type { StickerImageEditState, StickerPoint } from "../types/stickerEditing";

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

/** Contain-fits a source rectangle without cropping or stretching it. */
export const computeContainFitPlacement = (
    container: { width: number; height: number },
    source: { width: number; height: number },
) => {
    if (
        container.width <= 0
        || container.height <= 0
        || source.width <= 0
        || source.height <= 0
    ) {
        return {
            left: 0,
            top: 0,
            width: container.width,
            height: container.height,
        };
    }

    const scale = Math.min(container.width / source.width, container.height / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    return {
        left: (container.width - width) / 2,
        top: (container.height - height) / 2,
        width,
        height,
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
    const rawOffsetX = clickUnitX - cropSize / 2;
    const rawOffsetY = clickUnitY - cropSize / 2;
    const minOffsetX = Math.min(0, frame.w - cropSize);
    const maxOffsetX = Math.max(0, frame.w - cropSize);
    const minOffsetY = Math.min(0, frame.h - cropSize);
    const maxOffsetY = Math.max(0, frame.h - cropSize);
    const offsetX = Math.min(Math.max(rawOffsetX, minOffsetX), maxOffsetX);
    const offsetY = Math.min(Math.max(rawOffsetY, minOffsetY), maxOffsetY);

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

export const computeStickerWheelResizeFrame = (
    frame: { x: number; y: number; w: number; h: number },
    pointer: StickerPoint,
    deltaY: number,
    minimumSize = 24,
) => {
    const scaleFactor = Math.max(0.5, Math.min(1.5, Math.exp(-deltaY * 0.001)));
    const minimumScale = frame.w > 0 && frame.h > 0
        ? Math.max(minimumSize / frame.w, minimumSize / frame.h)
        : 1;
    const effectiveScale = Math.max(minimumScale, scaleFactor);
    const nextW = frame.w * effectiveScale;
    const nextH = frame.h * effectiveScale;
    const relativeX = Math.max(0, Math.min(frame.w, pointer.x - frame.x));
    const relativeY = Math.max(0, Math.min(frame.h, pointer.y - frame.y));

    return {
        x: frame.x + relativeX * (1 - effectiveScale),
        y: frame.y + relativeY * (1 - effectiveScale),
        w: nextW,
        h: nextH,
    };
};

export const computeCroppedStickerImageViewport = (
    frame: { w: number; h: number },
    imageEditState: Pick<StickerImageEditState, "cropRect" | "sourceSize"> | undefined,
) => {
    const cropRect = imageEditState?.cropRect;
    const sourceSize = imageEditState?.sourceSize;
    if (!cropRect || !sourceSize || cropRect.w <= 0 || cropRect.h <= 0) {
        return null;
    }

    const scaleX = frame.w / cropRect.w;
    const scaleY = frame.h / cropRect.h;
    return {
        width: sourceSize.w * scaleX,
        height: sourceSize.h * scaleY,
        offsetX: cropRect.x * scaleX,
        offsetY: cropRect.y * scaleY,
    };
};

export const computeMinifiedStickerViewport = (
    currentMiniFrame: { w: number; h: number },
    savedRect: { w: number; h: number } | undefined,
    cropOffset: { x: number; y: number } | undefined,
    imageEditState: Pick<StickerImageEditState, "cropRect" | "sourceSize"> | undefined,
    intrinsicSourceSize?: { w: number; h: number },
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

    if (savedRect && intrinsicSourceSize) {
        const placement = computeContainFitPlacement(
            { width: savedRect.w, height: savedRect.h },
            { width: intrinsicSourceSize.w, height: intrinsicSourceSize.h },
        );
        const visibleCropWidth = Math.max(1, currentMiniFrame.w);
        const visibleCropHeight = Math.max(1, currentMiniFrame.h);
        const offsetX = Math.min(
            Math.max(baseOffsetX - placement.left, 0),
            Math.max(0, placement.width - visibleCropWidth),
        );
        const offsetY = Math.min(
            Math.max(baseOffsetY - placement.top, 0),
            Math.max(0, placement.height - visibleCropHeight),
        );
        return {
            width: placement.width,
            height: placement.height,
            offsetX,
            offsetY,
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
