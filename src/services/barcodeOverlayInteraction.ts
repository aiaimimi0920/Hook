import type { BarcodeResult, Unit } from "../types/unit";
import { addOrUpdateRect, removeRect } from "./uiRegistry";
import type { OcrImageFrame } from "./ocrOverlayLayout";

export const BARCODE_OVERLAY_RECT_PREFIX = "BARCODE";

export const createBarcodeOverlayRectId = (unitId: string, resultId: string) =>
    `${BARCODE_OVERLAY_RECT_PREFIX}_${unitId}_${resultId}`;

export const resolveBarcodeOverlayRect = (
    unit: Unit,
    frame: OcrImageFrame,
    result: BarcodeResult,
) => {
    const bounds = result.bounds;
    if (!bounds) return null;
    const left = frame.left + bounds.left * frame.scaleX;
    const top = frame.top + bounds.top * frame.scaleY;
    const x = unit.x + Math.min(Math.max(left, 0), Math.max(unit.w - 24, 0));
    const y = unit.y + Math.min(Math.max(top - 10, 0), Math.max(unit.h - 24, 0));
    const width = Math.min(24, Math.max(unit.w, 1));
    const height = Math.min(24, Math.max(unit.h, 1));
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return {
        id: createBarcodeOverlayRectId(unit.id, result.id),
        x,
        y,
        width,
        height,
        name: BARCODE_OVERLAY_RECT_PREFIX,
    };
};

/** Replaces native hit rectangles so marker clicks are not forwarded to the desktop. */
export const syncBarcodeOverlayRects = (
    previousIds: string[],
    unit: Unit,
    frame: OcrImageFrame | null,
    interactive: boolean,
): string[] => {
    previousIds.forEach(removeRect);
    if (!interactive || !frame) return [];

    const nextIds: string[] = [];
    for (const result of unit.data.barcodeResult?.results ?? []) {
        const rect = resolveBarcodeOverlayRect(unit, frame, result);
        if (!rect) continue;
        addOrUpdateRect(rect);
        nextIds.push(rect.id);
    }
    return nextIds;
};

export const disposeBarcodeOverlayRects = (ids: string[]) => ids.forEach(removeRect);
