import { describe, expect, it, vi } from "vitest";

import {
    OCR_MONOSPACE_FONT_FAMILY,
    OCR_SANS_FONT_FAMILY,
    resolveOcrOverlayFontFamily,
    resolveOcrTextTypography,
} from "../../src/services/ocrOverlayTypography";

describe("OCR overlay typography", () => {
    it("uses one monospace family for terminal-like OCR groups", () => {
        expect(resolveOcrOverlayFontFamily([
            "release/Hook/hook-ocr-layout.exe",
            "SHA-256: 97b902f063074550",
            "普通说明文字",
        ])).toBe(OCR_MONOSPACE_FONT_FAMILY);
        expect(resolveOcrOverlayFontFamily([
            "需要手机号的账号",
            "送出去的无限号",
        ])).toBe(OCR_SANS_FONT_FAMILY);
    });

    it("chooses the installed family whose advances best match OCR geometry", () => {
        const measureText = vi.fn((text: string, font: string) =>
            font.startsWith("500 20px Consolas") ? text.length * 10 : text.length * 7);
        const samples = [
            { text: "release/Hook/test.exe", width: 212, paddingX: 1, fontSize: 20 },
            { text: "checksums.sha256", width: 162, paddingX: 1, fontSize: 20 },
        ];

        const family = resolveOcrOverlayFontFamily(
            samples.map((sample) => sample.text),
            samples,
            measureText,
        );

        expect(family).toMatch(/^Consolas/);
        expect(measureText).toHaveBeenCalled();
    });

    it("fits overflowing text without visibly flattening the source glyphs", () => {
        const fit = resolveOcrTextTypography({
            text: "abcdefghij",
            width: 82,
            paddingX: 1,
            fontSize: 20,
            fontFamily: OCR_SANS_FONT_FAMILY,
            measureText: (text) => text.length * 10,
        });

        expect(fit.letterSpacing).toBeLessThanOrEqual(0);
        expect(fit.letterSpacing).toBeGreaterThanOrEqual(-fit.fontSize * 0.006 - 0.001);
        expect(fit.scaleX).toBeGreaterThanOrEqual(0.96);
        expect(fit.scaleX).toBeLessThan(1);
        expect(fit.fontSize / 20 * fit.scaleX).toBeGreaterThanOrEqual(0.94);
    });

    it("contains tiny OCR text instead of painting it outside the screenshot", () => {
        const fit = resolveOcrTextTypography({
            text: "tiny text near edge",
            width: 24,
            paddingX: 0,
            fontSize: 8,
            lineHeight: 9,
            fontFamily: OCR_SANS_FONT_FAMILY,
            containOverflow: true,
            measureText: (text) => text.length * 4,
        });

        const measuredWidth = "tiny text near edge".length * 4;
        expect(measuredWidth * (fit.fontSize / 8) * fit.scaleX).toBeLessThanOrEqual(24.01);
        expect(fit.fontSize).toBeGreaterThanOrEqual(1);
    });

    it("bounds expansion when detector boxes contain generous padding", () => {
        const fit = resolveOcrTextTypography({
            text: "short",
            width: 300,
            paddingX: 2,
            fontSize: 20,
            fontFamily: OCR_SANS_FONT_FAMILY,
            measureText: () => 40,
        });

        expect(fit.letterSpacing).toBeLessThanOrEqual(fit.fontSize * 0.035);
        expect(fit.scaleX).toBeLessThanOrEqual(1.06);
    });

    it("uses a bounded font-size adjustment before distorting glyph width", () => {
        const fit = resolveOcrTextTypography({
            text: "terminal row",
            width: 100,
            paddingX: 2,
            fontSize: 18,
            lineHeight: 24,
            fontFamily: OCR_MONOSPACE_FONT_FAMILY,
            measureText: () => 88,
        });

        expect(fit.fontSize).toBeGreaterThan(18);
        expect(fit.fontSize).toBeLessThanOrEqual(24 * 0.86);
        expect(fit.scaleX).toBeGreaterThan(0.98);
    });

    it("measures visual rows independently and fits against the widest row", () => {
        const measureText = vi.fn((text: string) => text.length * 12);
        const fit = resolveOcrTextTypography({
            text: "longest row\n短行",
            width: 100,
            paddingX: 2,
            fontSize: 18,
            fontFamily: OCR_SANS_FONT_FAMILY,
            measureText,
        });

        expect(measureText).toHaveBeenCalledTimes(2);
        expect(measureText).toHaveBeenNthCalledWith(1, "longest row", expect.any(String));
        expect(fit.scaleX).toBeLessThan(1);
    });

    it("falls back to unmodified text when browser metrics are unavailable", () => {
        expect(resolveOcrTextTypography({
            text: "fallback",
            width: 100,
            paddingX: 2,
            fontSize: 18,
            fontFamily: OCR_SANS_FONT_FAMILY,
            measureText: () => null,
        })).toEqual({ fontSize: 18, letterSpacing: 0, scaleX: 1 });
    });

    it("never emits an invalid CSS font size for malformed geometry", () => {
        expect(resolveOcrTextTypography({
            text: "invalid",
            width: Number.NaN,
            paddingX: 0,
            fontSize: Number.NaN,
            fontFamily: OCR_SANS_FONT_FAMILY,
        })).toEqual({ fontSize: 1, letterSpacing: 0, scaleX: 1 });
    });
});
