import { describe, expect, it } from "vitest";
import { containedPreviewRect, physicalPreviewLayout, rectanglesOverlap } from "../../src/services/liveGpuPreviewPolicy";

describe("native GPU preview eligibility", () => {
    const rect = { x: 100, y: 50, width: 200, height: 100 };
    const viewport = { width: 1200, height: 800 };

    it.each([66, 67])("keeps DPI-rounded narrow crops on GPU without stretching (%s px)", (height) => {
        const box = { x: 421.3333435058594, y: 272, width: 436, height: 44 };
        expect(Math.abs(box.width / box.height - 655 / height)).toBeGreaterThan(0.01);
        const content = containedPreviewRect(box, 655, height)!;
        expect(content.width / content.height).toBeCloseTo(655 / height, 10);
        expect(content.x + content.width / 2).toBeCloseTo(box.x + box.width / 2, 10);
        expect(content.y + content.height / 2).toBeCloseTo(box.y + box.height / 2, 10);
        expect(content.width).toBeLessThanOrEqual(box.width);
        expect(content.height).toBeLessThanOrEqual(box.height);
        expect(physicalPreviewLayout(content, viewport, 1.5, [{ ...box, y: box.y + box.height }])).not.toBeNull();
    });

    it("fits centered letterboxing in both directions and rejects missing image dimensions", () => {
        expect(containedPreviewRect(rect, 100, 100)).toEqual({ x: 150, y: 50, width: 100, height: 100 });
        expect(containedPreviewRect(rect, 400, 100)).toEqual({ x: 100, y: 75, width: 200, height: 50 });
        for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(containedPreviewRect(rect, invalid, 100)).toBeNull();
            expect(containedPreviewRect(rect, 100, invalid)).toBeNull();
        }
    });

    it("converts the current DOM rectangle once, without changing Unit geometry", () => {
        expect(physicalPreviewLayout(rect, viewport, 1.5, [])).toEqual({
            x: 150, y: 75, width: 300, height: 150, inset: 3,
        });
        expect(rect).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    });

    it("fails back for overlap rather than painting over other Units or panels", () => {
        expect(physicalPreviewLayout(rect, viewport, 1, [{ x: 297, y: 50, width: 10, height: 10 }])).toBeNull();
        expect(rectanglesOverlap(rect, { x: 300, y: 50, width: 10, height: 10 })).toBe(false);
    });

    it("does not classify a fractional-DPI adjacent port as covering GPU pixels", () => {
        const image = { x: 1058.666748046875, y: 569.3333740234375, width: 443, height: 276 };
        const port = { x: 1058.6666666666667 + 443, y: 593.3333333333334, width: 18, height: 24 };
        expect(rectanglesOverlap(image, port)).toBe(true);
        expect(physicalPreviewLayout(image, { width: 2560, height: 1440 }, 1.5, [port])).not.toBeNull();
    });

    it("allows only the border already excluded by the native inset clip", () => {
        expect(physicalPreviewLayout(rect, viewport, 1.5, [{ x: 299, y: 60, width: 10, height: 10 }])).not.toBeNull();
        expect(physicalPreviewLayout(rect, viewport, 1.5, [{ x: 297, y: 60, width: 10, height: 10 }])).toBeNull();
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 9])("rejects invalid DPR %s", (dpr) => {
        expect(physicalPreviewLayout(rect, viewport, dpr, [])).toBeNull();
    });

    it("fails back for clipped, tiny, oversized or non-finite viewports", () => {
        expect(physicalPreviewLayout({ ...rect, x: -1 }, viewport, 1, [])).toBeNull();
        expect(physicalPreviewLayout({ ...rect, width: 8 }, viewport, 1, [])).toBeNull();
        expect(physicalPreviewLayout({ ...rect, x: 1100 }, viewport, 1, [])).toBeNull();
        expect(physicalPreviewLayout(rect, { ...viewport, width: Number.NaN }, 1, [])).toBeNull();
    });
});
