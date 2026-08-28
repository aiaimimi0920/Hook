import { describe, expect, it } from "vitest";

import {
    normalizeOcrLineGeometry,
    remapOcrLineGeometry,
    resolveOcrBaselineTextPlacement,
} from "../../src/services/ocrOverlayBaseline";
import type { OcrLineGeometry } from "../../src/types/unit";

const geometry: OcrLineGeometry = {
    baseline: [{ x: 10, y: 44.6 }, { x: 110, y: 44.6 }],
    angleDegrees: 0,
    source: "estimatedFromRapidOcrLineQuad",
};

const bounds = { minX: 10, maxX: 110, minY: 20, maxY: 50 };

describe("OCR overlay baseline geometry", () => {
    it("normalizes bounded Loom geometry and derives angle from its points", () => {
        expect(normalizeOcrLineGeometry({
            ...geometry,
            baseline: [{ x: 20, y: 89.2 }, { x: 220, y: 89.2 }],
            angleDegrees: 12,
        }, bounds, 2)).toEqual(geometry);
    });

    it("rejects malformed, distant, or steep untrusted geometry", () => {
        expect(normalizeOcrLineGeometry({
            ...geometry,
            baseline: [{ x: Number.NaN, y: 20 }, { x: 30, y: 20 }],
        }, bounds)).toBeUndefined();
        expect(normalizeOcrLineGeometry({
            ...geometry,
            baseline: [{ x: 10_000, y: 20 }, { x: 10_100, y: 20 }],
        }, bounds)).toBeUndefined();
        expect(normalizeOcrLineGeometry({
            ...geometry,
            baseline: [{ x: 20, y: 20 }, { x: 30, y: 50 }],
        }, bounds)).toBeUndefined();
    });

    it("keeps the baseline attached to collision-normalized row bounds", () => {
        const remapped = remapOcrLineGeometry(
            geometry,
            bounds,
            { minX: 10, maxX: 110, minY: 22, maxY: 46 },
        );

        expect(remapped?.baseline[0].x).toBeCloseTo(10);
        expect(remapped?.baseline[0].y).toBeCloseTo(41.68);
        expect(remapped?.angleDegrees).toBeCloseTo(0);
    });

    it("maps the source baseline into a rotated browser text placement", () => {
        const placement = resolveOcrBaselineTextPlacement(
            { left: 0, top: 25, width: 200, height: 50, scaleX: 0.5, scaleY: 0.5 },
            geometry,
            { left: 5, top: 35, width: 50, height: 15, lineHeight: 15 },
            12,
        );

        expect(placement?.left).toBeCloseTo(5);
        expect(placement?.top).toBeCloseTo(35.96);
        expect(placement?.width).toBeCloseTo(50);
        expect(placement?.baselineOffset).toBeCloseTo(11.34);
        expect(placement?.angleDegrees).toBeCloseTo(0);
    });

    it("falls back when baseline placement would paint outside the screenshot", () => {
        expect(resolveOcrBaselineTextPlacement(
            { left: 0, top: 0, width: 100, height: 50, scaleX: 1, scaleY: 1 },
            {
                ...geometry,
                baseline: [{ x: 0, y: 3 }, { x: 60, y: 3 }],
            },
            { left: 0, top: 0, width: 60, height: 10, lineHeight: 10 },
            8,
        )).toBeUndefined();
    });
});
