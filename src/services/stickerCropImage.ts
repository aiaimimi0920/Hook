import type { StickerImageEditState } from "../types/stickerEditing";
import { computeContainFitPlacement, computeCroppedStickerImageViewport } from "./stickerFrameGeometry";

type CropState = Pick<StickerImageEditState, "cropRect" | "sourceSize" | "flippedX" | "flippedY">;
type Frame = { x: number; y: number; w: number; h: number };

// cropRect/sourceSize are logical source-frame coordinates, never natural image
// pixels. Recreate the pre-crop contain-fit, then window it, just like the DOM.
export const computeCroppedImagePlacement = (
    frame: Frame,
    state: CropState | undefined,
    source: { width: number; height: number },
) => {
    const viewport = computeCroppedStickerImageViewport(frame, state);
    if (!viewport) return null;
    const contained = computeContainFitPlacement(viewport, source);
    return {
        left: frame.x + contained.left - viewport.offsetX,
        top: frame.y + contained.top - viewport.offsetY,
        width: contained.width,
        height: contained.height,
    };
};

export const croppedImageSourceResolution = (
    state: CropState | undefined,
    source: { width: number; height: number },
) => {
    const crop = state?.cropRect;
    const size = state?.sourceSize;
    if (!crop || !size || size.w <= 0 || size.h <= 0) return null;
    const density = Math.max(source.width / size.w, source.height / size.h);
    return { width: crop.w * density, height: crop.h * density };
};

export const drawCroppedStickerImage = (
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    frame: Frame,
    state: CropState,
) => {
    const placement = computeCroppedImagePlacement(frame, state, {
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
    });
    if (!placement) return false;
    context.save();
    context.beginPath();
    context.rect(frame.x, frame.y, frame.w, frame.h);
    context.clip();
    // Flip the full source before cropping, not the already-cropped fragment.
    context.translate(placement.left + placement.width / 2, placement.top + placement.height / 2);
    context.scale(state.flippedX ? -1 : 1, state.flippedY ? -1 : 1);
    context.drawImage(image, -placement.width / 2, -placement.height / 2, placement.width, placement.height);
    context.restore();
    return true;
};
