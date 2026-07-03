import { describe, expect, it } from "vitest";

import { scaleStickerFrame } from "../../src/services/stickerEditing";

describe("sticker scale helper", () => {
    it("scales a sticker frame around its center", () => {
        expect(scaleStickerFrame({ x: 100, y: 200, w: 300, h: 120 }, 1.1)).toEqual({
            x: 85,
            y: 194,
            w: 330,
            h: 132,
        });

        expect(scaleStickerFrame({ x: 100, y: 200, w: 300, h: 120 }, 0.9)).toEqual({
            x: 115,
            y: 206,
            w: 270,
            h: 108,
        });
    });

    it("enforces a minimum visible size", () => {
        expect(scaleStickerFrame({ x: 10, y: 10, w: 24, h: 18 }, 0.5, 16)).toEqual({
            x: 14,
            y: 11,
            w: 16,
            h: 16,
        });
    });
});
