import { describe, expect, it } from "vitest";

import {
    STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT,
    STICKER_TOP_STRIP_HEIGHT,
    STICKER_TOP_STRIP_SLOT_COUNT,
    STICKER_TOP_STRIP_SLOT_WIDTH,
    STICKER_TOP_STRIP_MIN_WIDTH,
    computeStickerTopStripLayout,
    computeStickerTopStripFrame,
} from "../../src/services/stickerTopStripLayout";

describe("sticker top strip layout", () => {
    it("uses the approved 50px toolbar height", () => {
        expect(STICKER_TOP_STRIP_HEIGHT).toBe(50);
        expect(STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT).toBe(40);
    });

    it("matches the toolbar width to the current tool count instead of stretching to the sticker width", () => {
        expect(STICKER_TOP_STRIP_SLOT_WIDTH).toBe(50);
        expect(STICKER_TOP_STRIP_SLOT_COUNT).toBeGreaterThanOrEqual(10);
        expect(STICKER_TOP_STRIP_MIN_WIDTH).toBe(
            STICKER_TOP_STRIP_SLOT_WIDTH * STICKER_TOP_STRIP_SLOT_COUNT,
        );
    });

    it("anchors above the sticker and left-aligns to the sticker by default", () => {
        const frame = computeStickerTopStripFrame({ x: 240, y: 220, w: 520, h: 180 }, 1440, 900);

        expect(frame.left).toBe(240);
        expect(frame.top).toBe(220 - STICKER_TOP_STRIP_HEIGHT);
        expect(frame.width).toBe(STICKER_TOP_STRIP_MIN_WIDTH);
        expect(frame.height).toBe(STICKER_TOP_STRIP_HEIGHT);
    });

    it("keeps the strip inside the viewport and honors the minimum width", () => {
        const frame = computeStickerTopStripFrame({ x: -80, y: 260, w: 220, h: 140 }, 800, 600);

        expect(frame.left).toBe(0);
        expect(frame.width).toBe(STICKER_TOP_STRIP_MIN_WIDTH);
        expect(frame.top).toBe(260 - STICKER_TOP_STRIP_HEIGHT);
    });

    it("moves the strip below the sticker when there is no room above", () => {
        const frame = computeStickerTopStripFrame({ x: 120, y: 40, w: 300, h: 180 }, 900, 720);

        expect(frame.left).toBe(120);
        expect(frame.top).toBe(40 + 180);
        expect(frame.height).toBe(STICKER_TOP_STRIP_HEIGHT);
    });

    it("shifts left when the strip would overflow the right edge", () => {
        const frame = computeStickerTopStripFrame({ x: 620, y: 260, w: 260, h: 180 }, 900, 720);

        expect(frame.width).toBe(STICKER_TOP_STRIP_MIN_WIDTH);
        expect(frame.left).toBe(900 - STICKER_TOP_STRIP_MIN_WIDTH);
    });

    it("chooses the side with more visible room when neither above nor below fully fits", () => {
        const frame = computeStickerTopStripFrame({ x: 140, y: 40, w: 500, h: 500 }, 960, 560);

        expect(frame.left).toBe(140);
        expect(frame.top).toBe(0);
        expect(frame.height).toBe(STICKER_TOP_STRIP_HEIGHT);
    });

    it("keeps the old single-row geometry when no secondary property bar is visible", () => {
        const layout = computeStickerTopStripLayout({ x: 240, y: 220, w: 520, h: 180 }, 1440, 900, false);

        expect(layout.container.left).toBe(240);
        expect(layout.container.top).toBe(220 - STICKER_TOP_STRIP_HEIGHT);
        expect(layout.container.height).toBe(STICKER_TOP_STRIP_HEIGHT);
        expect(layout.mainBar.top).toBe(220 - STICKER_TOP_STRIP_HEIGHT);
        expect(layout.propertyBar).toBeNull();
    });

    it("stacks a 40px property bar above the main row when the selected tool exposes secondary properties", () => {
        const layout = computeStickerTopStripLayout({ x: 240, y: 220, w: 520, h: 180 }, 1440, 900, true);

        expect(layout.container.left).toBe(240);
        expect(layout.container.top).toBe(220 - STICKER_TOP_STRIP_HEIGHT - STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT);
        expect(layout.container.height).toBe(STICKER_TOP_STRIP_HEIGHT + STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT);
        expect(layout.propertyBar?.top).toBe(220 - STICKER_TOP_STRIP_HEIGHT - STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT);
        expect(layout.propertyBar?.height).toBe(STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT);
        expect(layout.mainBar.top).toBe(220 - STICKER_TOP_STRIP_HEIGHT);
    });

    it("preserves the internal order when the stacked top strip is forced below the sticker", () => {
        const layout = computeStickerTopStripLayout({ x: 120, y: 40, w: 300, h: 180 }, 900, 720, true);

        expect(layout.container.top).toBe(40 + 180);
        expect(layout.propertyBar?.top).toBe(40 + 180);
        expect(layout.mainBar.top).toBe(40 + 180 + STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT);
    });
});
