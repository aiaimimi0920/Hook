import { describe, expect, it } from "vitest";

import {
    resolveOcrOverlaySpanGeometry,
} from "../../src/services/ocrOverlaySpanGeometry";
import type { OcrTextSpan } from "../../src/types/unit";

const span = (text: string, left: number, right: number): OcrTextSpan => ({
    text,
    boxPoints: [
        { x: left, y: 10 },
        { x: right, y: 10 },
        { x: right, y: 30 },
        { x: left, y: 30 },
    ],
    score: 0.9,
    source: "ctcAlignedFromRecognitionTimesteps",
});

const lineBounds = { minX: 0, maxX: 100, minY: 0, maxY: 40 };

describe("OCR overlay span geometry", () => {
    it("retains validated character extents as recognition evidence", () => {
        const geometry = resolveOcrOverlaySpanGeometry(
            [span("A", 10, 20), span("B", 24, 36)],
            [span("AB", 10, 36)],
            "AB",
            lineBounds,
        );

        expect(geometry?.characterSpans).toHaveLength(2);
        expect(geometry?.textBounds).toEqual({ minX: 10, maxX: 36, minY: 10, maxY: 30 });
    });

    it("falls back when text, source, order, or coordinates are untrusted", () => {
        expect(resolveOcrOverlaySpanGeometry(
            [span("A", 10, 20)],
            [],
            "B",
            lineBounds,
        )).toBeUndefined();
        expect(resolveOcrOverlaySpanGeometry(
            [span("A", 30, 40), span("B", 10, 20)],
            [],
            "AB",
            lineBounds,
        )).toBeUndefined();
        expect(resolveOcrOverlaySpanGeometry(
            [{ ...span("A", 10, 20), score: Number.NaN }],
            [],
            "A",
            lineBounds,
        )).toBeUndefined();
        expect(resolveOcrOverlaySpanGeometry(
            [{ ...span("A", 10, 20), source: "invalid" }],
            [],
            "A",
            lineBounds,
        )).toBeUndefined();
    });

    it("normalizes high-resolution span coordinates with the result scale", () => {
        const geometry = resolveOcrOverlaySpanGeometry(
            [span("A", 20, 40)],
            [],
            "A",
            lineBounds,
            2,
        );

        expect(geometry?.textBounds).toEqual({ minX: 10, maxX: 20, minY: 5, maxY: 15 });
    });
});
