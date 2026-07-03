import { describe, expect, it } from "vitest";

import {
    TRANSPARENT_STICKER_COLOR,
    addStickerPaletteColor,
    adjustStickerOpacity,
    adjustStrokeWidth,
    adjustTextSize,
    buildSerialAnnotationMetrics,
    createDefaultStickerColorState,
    createDefaultStickerToolSettings,
    normalizeStickerPaletteColor,
    removeStickerPaletteColor,
} from "../../src/services/stickerEditing";
import { normalizeStickerToolSettings } from "../../src/services/toolSettings";

describe("sticker style controls", () => {
    it("adjusts stroke width in predictable one-pixel steps and allows zero-width borders", () => {
        expect(adjustStrokeWidth(3, -1)).toBe(2);
        expect(adjustStrokeWidth(1, -1)).toBe(0);
        expect(adjustStrokeWidth(0, -1)).toBe(0);
        expect(adjustStrokeWidth(15, 2)).toBe(16);
    });

    it("keeps each shape/line tool's stroke and fill colors independent while sharing one palette", () => {
        expect(createDefaultStickerToolSettings()).toMatchObject({
            rectStrokeColor: "#ef4444",
            rectFillColor: TRANSPARENT_STICKER_COLOR,
            ellipseStrokeColor: "#ef4444",
            ellipseFillColor: TRANSPARENT_STICKER_COLOR,
            triangleStrokeColor: "#ef4444",
            triangleFillColor: TRANSPARENT_STICKER_COLOR,
            polygonStrokeColor: "#ef4444",
            polygonFillColor: TRANSPARENT_STICKER_COLOR,
            lineStrokeColor: "#ef4444",
            shapeCornerRadius: 0,
            lineArrowEnabled: false,
            brushColor: "#ef4444",
            brushHighlighterEnabled: false,
            effectBorderColor: "#ef4444",
            effectBorderWidth: 1,
            mosaicColorA: "#000000",
            mosaicColorB: "#ffffff",
            serialForegroundColor: "#ef4444",
            serialFillColor: "#000000",
            serialRadius: 14,
        });

        const palette = createDefaultStickerColorState().palette;
        expect(palette).toContain(TRANSPARENT_STICKER_COLOR);
        expect(palette).toContain("#ef4444");
    });

    it("normalizes user-added palette colors and allows deleting any palette color", () => {
        expect(normalizeStickerPaletteColor("ff0000")).toBe("#ff0000");
        expect(normalizeStickerPaletteColor("#0AF")).toBe("#00aaff");
        expect(normalizeStickerPaletteColor("not-a-color")).toBeNull();

        const withCustom = addStickerPaletteColor(["#ffffff"], "#ABCDEF");
        expect(withCustom).toEqual(["#ffffff", "#abcdef"]);
        expect(addStickerPaletteColor(withCustom, "#abcdef")).toEqual(withCustom);
        expect(removeStickerPaletteColor(withCustom, "#abcdef")).toEqual(["#ffffff"]);
        expect(removeStickerPaletteColor(withCustom, "#ffffff")).toEqual(["#abcdef"]);
    });

    it("adjusts text size in predictable two-pixel steps with sane bounds", () => {
        expect(adjustTextSize(16, -2)).toBe(14);
        expect(adjustTextSize(10, -2)).toBe(10);
        expect(adjustTextSize(48, 4)).toBe(48);
    });

    it("allows sticker opacity steppers to reduce all the way to zero", () => {
        expect(adjustStickerOpacity(0.2, -0.1)).toBe(0.1);
        expect(adjustStickerOpacity(0.1, -0.1)).toBe(0);
        expect(adjustStickerOpacity(0, -0.1)).toBe(0);
    });

    it("derives serial digit and border size from the configured radius", () => {
        expect(buildSerialAnnotationMetrics(14)).toEqual({
            radius: 14,
            fontSize: 16,
            borderWidth: 2,
        });
        expect(buildSerialAnnotationMetrics(8)).toMatchObject({
            radius: 8,
            fontSize: 10,
            borderWidth: 1,
        });
        expect(buildSerialAnnotationMetrics(96)).toMatchObject({
            radius: 96,
            fontSize: 110,
            borderWidth: 14,
        });
    });

    it("normalizes legacy highlighter selection into brush plus the highlighter toggle", () => {
        expect(
            normalizeStickerToolSettings({
                domain: "create",
                mode: "highlighter",
                activeTool: "highlighter",
                brushHighlighterEnabled: false,
            }),
        ).toMatchObject({
            domain: "create",
            mode: "brush",
            activeTool: "brush",
            brushHighlighterEnabled: true,
        });
    });
});
