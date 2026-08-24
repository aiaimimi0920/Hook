import { describe, expect, it } from "vitest";

import {
    sanitizeCanvasDimension,
    sanitizeContentEraserSize,
    sanitizeEffectBrushSize,
    sanitizeEffectStrength,
    sanitizePolygonSides,
    sanitizeStickerPoints,
    sanitizeStickerRect,
    sanitizeStrokeWidth,
} from "../../src/components/stickerAnnotationNumericSafety";

describe("sticker annotation numeric safety", () => {
    it("normalizes non-finite and out-of-range settings to UI-supported limits", () => {
        expect(sanitizeCanvasDimension(Number.NaN)).toBe(1);
        expect(sanitizeCanvasDimension(Number.POSITIVE_INFINITY)).toBe(1);
        expect(sanitizeStrokeWidth(Number.NaN)).toBe(3);
        expect(sanitizeStrokeWidth(999)).toBe(96);
        expect(sanitizePolygonSides(4.6)).toBe(5);
        expect(sanitizePolygonSides(Number.NaN)).toBe(6);
        expect(sanitizeEffectBrushSize(-1)).toBe(4);
        expect(sanitizeEffectStrength(Number.NaN, 8)).toBe(8);
        expect(sanitizeContentEraserSize(999)).toBe(96);
    });

    it("drops non-finite points and clamps extreme finite coordinates", () => {
        expect(sanitizeStickerPoints([
            { x: 10, y: 20 },
            { x: Number.NaN, y: 3 },
            { x: 2_000_000, y: -2_000_000 },
        ])).toEqual([
            { x: 10, y: 20 },
            { x: 1_000_000, y: -1_000_000 },
        ]);
    });

    it("rejects non-finite rectangles before persistence", () => {
        expect(sanitizeStickerRect({ x: 0, y: 0, w: Number.NaN, h: 10 })).toBeNull();
        expect(sanitizeStickerRect({ x: -2_000_000, y: 0, w: 2_000_000, h: -5 })).toEqual({
            x: -1_000_000,
            y: 0,
            w: 1_000_000,
            h: 0,
        });
    });
});
