import { describe, expect, it } from "vitest";

import {
    resolveOcrBlockBounds,
    resolveOcrImageFrame,
    resolveOcrOverlayColor,
} from "../../src/components/UnitVisualOverlays";
import type { Unit } from "../../src/types/unit";

const unitWithOcr = (width: number, height: number): Unit => ({
    id: "ocr-unit",
    type: "sticker",
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        ocrResult: { fullText: "", textBlocks: [], width, height },
    },
});

describe("Unit visual OCR overlay validation", () => {
    it("rejects empty and non-finite OCR geometry", () => {
        expect(resolveOcrBlockBounds([])).toBeNull();
        expect(resolveOcrBlockBounds([{ x: Number.NaN, y: 2 }])).toBeNull();
        expect(resolveOcrImageFrame(unitWithOcr(0, 100), false)).toBeNull();
        expect(resolveOcrImageFrame(unitWithOcr(Number.POSITIVE_INFINITY, 100), false)).toBeNull();
    });

    it("computes finite bounds and contain-fit geometry", () => {
        expect(resolveOcrBlockBounds([{ x: 3, y: 7 }, { x: 13, y: 17 }])).toEqual({
            minX: 3,
            maxX: 13,
            minY: 7,
            maxY: 17,
        });
        expect(resolveOcrImageFrame(unitWithOcr(400, 100), false)).toEqual({
            left: 0,
            top: 25,
            width: 200,
            height: 50,
            scaleX: 0.5,
            scaleY: 0.5,
        });
    });

    it("accepts only six- or eight-digit hex colors", () => {
        expect(resolveOcrOverlayColor("#12aBcF", "#ffffff")).toBe("#12aBcF");
        expect(resolveOcrOverlayColor("#12abcdef", "#ffffff")).toBe("#12abcdef");
        expect(resolveOcrOverlayColor("url(javascript:bad)", "#ffffff")).toBe("#ffffff");
    });
});
