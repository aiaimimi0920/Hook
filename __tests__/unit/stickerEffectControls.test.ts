import { describe, expect, it } from "vitest";

import { adjustEffectStrength } from "../../src/services/stickerEditing";

describe("sticker effect controls", () => {
    it("adjusts blur and mosaic strengths in bounded integer steps", () => {
        expect(adjustEffectStrength(8, -2)).toBe(6);
        expect(adjustEffectStrength(2, -4)).toBe(2);
        expect(adjustEffectStrength(62, 8)).toBe(64);
    });
});
