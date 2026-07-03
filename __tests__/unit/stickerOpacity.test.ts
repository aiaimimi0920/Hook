import { describe, expect, it } from "vitest";

import { adjustStickerOpacity } from "../../src/services/stickerEditing";

describe("sticker opacity helper", () => {
    it("clamps opacity adjustments into the visible 0..1 range", () => {
        expect(adjustStickerOpacity(1, -0.2)).toBe(0.8);
        expect(adjustStickerOpacity(0.15, -0.2)).toBe(0);
        expect(adjustStickerOpacity(0.95, 0.2)).toBe(1);
    });

    it("keeps one decimal place for predictable UI stepping", () => {
        expect(adjustStickerOpacity(0.84, 0.07)).toBe(0.9);
        expect(adjustStickerOpacity(0.84, -0.07)).toBe(0.8);
    });
});
