import { describe, expect, it } from "vitest";

import {
    resolveOcrOverlayFillColor,
    resolveOcrOverlayTextColor,
} from "../../src/services/ocrOverlayFillColor";

const parseHex = (value: string) => [1, 3, 5].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
);

const contrastRatio = (leftHex: string, rightHex: string) => {
    const luminance = (hex: string) => {
        const channels = parseHex(hex).map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const left = luminance(leftHex);
    const right = luminance(rightHex);
    return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
};

describe("OCR overlay source-region fill color", () => {
    it("preserves a distinct sampled background for every block", () => {
        const blocks = [
            { colorHex: "#ffffff", bgColorHex: "#101010" },
            { colorHex: "#22c55e", bgColorHex: "#f7f8ef" },
            { colorHex: "#06080d", bgColorHex: "#d9ff38" },
        ];

        for (const block of blocks) {
            expect(resolveOcrOverlayFillColor(block)).toEqual({ hex: block.bgColorHex });
        }
    });

    it("uses a stable safe fallback for missing or malformed OCR colors", () => {
        const fallback = { hex: "#ffffff" };

        expect(resolveOcrOverlayFillColor(undefined)).toEqual(fallback);
        expect(resolveOcrOverlayFillColor({
            colorHex: "url(javascript:bad)", bgColorHex: "transparent",
        })).toEqual(fallback);
        expect(resolveOcrOverlayFillColor(null)).toEqual(fallback);
        expect(resolveOcrOverlayFillColor({})).toEqual(fallback);
    });

    it("does not reject a red background that genuinely belongs to the image", () => {
        expect(resolveOcrOverlayFillColor({ bgColorHex: "#C02030" }).hex).toBe("#c02030");
    });

    it("replaces an antialiased low-contrast sample with a readable neutral foreground", () => {
        const fill = "#140b42";
        const text = resolveOcrOverlayTextColor("#727272", fill);

        expect(text).toBe("#f8fafc");
        expect(contrastRatio(text, fill)).toBeGreaterThanOrEqual(4.5);
        expect(resolveOcrOverlayTextColor("#f8fafc", fill)).toBe("#f8fafc");
    });

    it("accepts eight-digit inputs while returning an opaque six-digit color", () => {
        const fill = resolveOcrOverlayFillColor({ colorHex: "#ffffff80", bgColorHex: "#000000cc" });

        expect(fill.hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(fill.hex).not.toBe("#ffffff");
        expect(fill.hex).toBe("#000000");
    });

    it("keeps text readable on both light and dark source backgrounds", () => {
        for (const background of ["#f8f0d8", "#181818", "#c02030", "#808080"]) {
            const text = resolveOcrOverlayTextColor(background, background);
            expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
        }
    });
});
