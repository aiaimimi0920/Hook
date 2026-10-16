import { afterEach, describe, expect, it, vi } from "vitest";

describe("sticker text geometry", () => {
    it("uses a fixed font-wide frame including descent instead of a one-em Han-only frame", async () => {
        const context = { font: "", measureText: vi.fn(() => ({
            width: 360, fontBoundingBoxAscent: 130, fontBoundingBoxDescent: 30,
            actualBoundingBoxAscent: 112, actualBoundingBoxDescent: 34,
        })) };
        vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }) });
        const { getTextAnnotationMetrics } = await import("../../src/features/stickers/services/stickerTextGeometry");
        const bounds = getTextAnnotationMetrics({ id: "text", type: "text", x: 50, y: 200,
            text: "你好呀gy", fontSize: 120, fontFamily: "微软雅黑", zIndex: 1, style: { color: "#ff0000", width: 1 } });
        expect(bounds.top).toBe(66);
        expect(bounds.height).toBe(172);
        expect(bounds.top + bounds.height).toBe(238);
        expect(bounds.top + bounds.height).toBeGreaterThan(200);
        expect(bounds.centerY).toBe(152);
    });
    it("reserves fixed space for j below the baseline and left of its origin", async () => {
        const measureText = vi.fn((text: string) => ({ width: text === "j" ? 30 : 300,
            fontBoundingBoxAscent: 128, fontBoundingBoxDescent: 36,
            actualBoundingBoxAscent: 115, actualBoundingBoxDescent: 34,
            actualBoundingBoxLeft: text === "j" ? 11 : 0, actualBoundingBoxRight: text === "j" ? 28 : 300 }));
        vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({ font: "", measureText }) }) });
        const { getTextLineMetrics } = await import("../../src/features/stickers/services/stickerTextGeometry");
        const line = getTextLineMetrics(120, "微软雅黑");
        expect(line.height).toBe(172);
        expect(line.sidePadding).toBe(13);
        expect(line.height / 2 + line.baselineOffset).toBe(132);
        expect(line.height / 2 - line.baselineOffset).toBe(40);
        expect(measureText.mock.calls.map(([text]) => text)).toEqual(["国你好AgjpqyÉÅ", "j"]);
    });
    it("retains baseline-relative negative descent and falls back for whitespace", async () => {
        const context = { font: "", measureText: vi.fn((text: string) => ({
            width: 80, fontBoundingBoxAscent: 100, fontBoundingBoxDescent: 25,
            actualBoundingBoxAscent: text.trim() ? 70 : 0,
            actualBoundingBoxDescent: text.trim() ? -2 : 0,
        })) };
        vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }) });
        const { measureTextLayout } = await import("../../src/features/stickers/services/stickerTextGeometry");
        expect(measureTextLayout("23", 120)).toMatchObject({ ascent: 70, descent: -2, height: 68 });
        expect(measureTextLayout(" ", 120)).toMatchObject({ ascent: 100, descent: 25, height: 125 });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it("reuses one detached canvas context across text measurements", async () => {
        const context = {
            font: "",
            measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
        };
        const getContext = vi.fn(() => context);
        const createElement = vi.fn(() => ({ getContext }));
        vi.stubGlobal("document", { createElement });

        const { measureTextWidth } = await import("../../src/features/stickers/services/stickerTextGeometry");

        expect(measureTextWidth("one", 20)).toBe(30);
        expect(measureTextWidth("three", 20)).toBe(50);
        expect(createElement).toHaveBeenCalledTimes(1);
        expect(getContext).toHaveBeenCalledTimes(1);
        expect(context.measureText).toHaveBeenCalledTimes(2);
    });
});
