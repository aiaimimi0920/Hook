/** Pure pointer, shape, line and crop geometry for sticker editing. */
import type { StickerImageEditState, StickerPoint } from "../types/stickerEditing";

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
        /** Angle increment in degrees when angle locking is active. */
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
