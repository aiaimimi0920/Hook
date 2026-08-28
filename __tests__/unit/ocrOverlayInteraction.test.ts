import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Unit } from "../../src/types/unit";

const { addOrUpdateRect, copyTextToClipboard, removeRect } = vi.hoisted(() => ({
    addOrUpdateRect: vi.fn(),
    copyTextToClipboard: vi.fn(),
    removeRect: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
    api: { copyTextToClipboard },
}));

vi.mock("../../src/services/uiRegistry", () => ({
    addOrUpdateRect,
    removeRect,
}));

import {
    copyOcrTextToClipboard,
    syncOcrOverlayRects,
} from "../../src/services/ocrOverlayInteraction";

describe("OCR overlay clipboard interaction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns the native clipboard result", async () => {
        copyTextToClipboard.mockResolvedValue(true);

        await expect(copyOcrTextToClipboard("recognized text")).resolves.toBe(true);
    });

    it("turns unexpected transport rejection into visible failure state", async () => {
        copyTextToClipboard.mockRejectedValue(new Error("transport failed"));

        await expect(copyOcrTextToClipboard("recognized text")).resolves.toBe(false);
    });

    it("registers the exact translated layout rendered by the overlay", () => {
        const unit = { id: "unit-1", x: 100, y: 200, data: {} } as Unit;
        const ids = syncOcrOverlayRects(
            ["stale"],
            unit,
            { left: 5, top: 7, width: 400, height: 200, scaleX: 2, scaleY: 3 },
            true,
            [{
                text: "translated row",
                copyText: "translated row",
                bounds: { minX: 10, maxX: 30, minY: 20, maxY: 25 },
                colorHex: "#ffffff",
                bgColorHex: "#000000",
            }],
        );

        expect(removeRect.mock.calls[0]?.[0]).toBe("stale");
        expect(addOrUpdateRect).toHaveBeenCalledWith({
            id: "OCR_TEXT_unit-1_0",
            x: 125,
            y: 267,
            width: 40,
            height: 15,
            name: "OCR_TEXT",
        });
        expect(ids).toEqual(["OCR_TEXT_unit-1_0"]);
    });

    it("clips native hit rectangles to the visible screenshot frame", () => {
        const unit = { id: "unit-1", x: 100, y: 200, data: {} } as Unit;
        syncOcrOverlayRects(
            [],
            unit,
            { left: 5, top: 7, width: 400, height: 200, scaleX: 2, scaleY: 2 },
            true,
            [{
                text: "edge",
                copyText: "edge",
                bounds: { minX: 190, maxX: 230, minY: 90, maxY: 120 },
                colorHex: "#ffffff",
                bgColorHex: "#000000",
            }],
        );

        expect(addOrUpdateRect).toHaveBeenCalledWith({
            id: "OCR_TEXT_unit-1_0",
            x: 485,
            y: 387,
            width: 20,
            height: 20,
            name: "OCR_TEXT",
        });
    });
});
