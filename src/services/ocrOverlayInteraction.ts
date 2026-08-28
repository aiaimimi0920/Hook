import type { Unit } from "../types/unit";
import { api } from "./api";
import { addOrUpdateRect, removeRect } from "./uiRegistry";
import {
    clipOcrBoundsToFrame,
    type OcrBlockBounds,
    type OcrImageFrame,
    type OcrOverlayBlock,
} from "./ocrOverlayLayout";

export const OCR_OVERLAY_RECT_PREFIX = "OCR_TEXT";

export const createOcrOverlayRectId = (unitId: string, blockIndex: number) =>
    `${OCR_OVERLAY_RECT_PREFIX}_${unitId}_${blockIndex}`;

export const resolveOcrOverlayRect = (
    unit: Unit,
    frame: OcrImageFrame,
    bounds: OcrBlockBounds,
    blockIndex: number,
) => {
    const clippedBounds = clipOcrBoundsToFrame(frame, bounds);
    if (!clippedBounds) return null;
    const width = Math.max((clippedBounds.maxX - clippedBounds.minX) * frame.scaleX, 1);
    const height = Math.max((clippedBounds.maxY - clippedBounds.minY) * frame.scaleY, 1);
    const x = unit.x + frame.left + clippedBounds.minX * frame.scaleX;
    const y = unit.y + frame.top + clippedBounds.minY * frame.scaleY;
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return {
        id: createOcrOverlayRectId(unit.id, blockIndex),
        x,
        y,
        width,
        height,
        name: OCR_OVERLAY_RECT_PREFIX,
    };
};

/** Replaces this unit's native hit rectangles without retaining stale blocks. */
export const syncOcrOverlayRects = (
    previousIds: string[],
    unit: Unit,
    frame: OcrImageFrame | null,
    interactive: boolean,
    overlayBlocks: readonly OcrOverlayBlock[],
): string[] => {
    previousIds.forEach(removeRect);
    if (!interactive || !frame) return [];

    const nextIds: string[] = [];
    for (const [index, block] of overlayBlocks.entries()) {
        const bounds = block.bounds;
        const rect = resolveOcrOverlayRect(unit, frame, bounds, index);
        if (!rect) continue;
        addOrUpdateRect(rect);
        nextIds.push(rect.id);
    }
    return nextIds;
};

export const disposeOcrOverlayRects = (ids: string[]) => ids.forEach(removeRect);

export const copyOcrTextToClipboard = async (text: string): Promise<boolean> => {
    try {
        return await api.copyTextToClipboard(text);
    } catch {
        // An unexpected transport rejection must still produce visible failure
        // feedback instead of leaving the pointer gesture silently unresolved.
        return false;
    }
};
