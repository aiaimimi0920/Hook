import { describe, expect, it } from "vitest";
import { placeStickerSettings } from "../../src/services/stickerSettingsPlacement";
import { resolveStickerTopStripPropertyTool } from "../../src/components/stickerToolbarModel";

describe("sticker settings placement", () => {
    const panel = { w: 96, h: 160 };
    it("prefers the sticker left edge with aligned tops when both sides fit", () => {
        expect(placeStickerSettings({ x: 100, y: 200, w: 560, h: 350 }, { w: 1200, h: 800 }, panel)).toEqual({ x: 4, y: 200, w: 96, h: 160 });
    });
    it("touches the left edge when the right side has no space", () => {
        expect(placeStickerSettings({ x: 630, y: 200, w: 560, h: 350 }, { w: 1200, h: 800 }, panel)).toEqual({ x: 534, y: 200, w: 96, h: 160 });
    });
    it("falls back to the right edge when the left side has no space", () => {
        expect(placeStickerSettings({ x: 50, y: 200, w: 560, h: 350 }, { w: 1200, h: 800 }, panel)).toEqual({ x: 610, y: 200, w: 96, h: 160 });
    });
    it("uses the bottom or top without a gap if neither side fits", () => {
        expect(placeStickerSettings({ x: 20, y: 200, w: 280, h: 350 }, { w: 320, h: 800 }, panel).y).toBe(550);
        expect(placeStickerSettings({ x: 20, y: 200, w: 280, h: 350 }, { w: 320, h: 600 }, panel).y).toBe(40);
    });
    it("clamps to small viewports and the lower screen edge", () => {
        expect(placeStickerSettings({ x: 10, y: 780, w: 500, h: 200 }, { w: 1200, h: 800 }, panel).y).toBe(640);
        expect(placeStickerSettings({ x: 0, y: 0, w: 50, h: 50 }, { w: 50, h: 60 }, panel)).toEqual({ x: 0, y: 0, w: 50, h: 60 });
    });
    it("does not open crop properties but preserves eraser properties", () => {
        expect(resolveStickerTopStripPropertyTool("sticker", "brush", "crop")).toBeNull();
        expect(resolveStickerTopStripPropertyTool("sticker", "brush", "content-eraser")).toBe("content-eraser");
    });
});
