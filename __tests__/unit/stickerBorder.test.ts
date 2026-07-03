import { describe, expect, it } from "vitest";

import { toggleStickerBorder } from "../../src/services/stickerEditing";
import type { StickerImageEditState } from "../../src/types/stickerEditing";

describe("sticker border helper", () => {
    it("adds a default border when none exists", () => {
        const state: StickerImageEditState = { contentEraseStrokes: [] };

        expect(toggleStickerBorder(state, "#ef4444")).toMatchObject({
            borderWidth: 4,
            borderColor: "#ef4444",
        });
    });

    it("clears the border when toggled with the same active color", () => {
        const state: StickerImageEditState = {
            contentEraseStrokes: [],
            borderWidth: 4,
            borderColor: "#ef4444",
        };

        expect(toggleStickerBorder(state, "#ef4444")).toMatchObject({
            borderWidth: 0,
            borderColor: undefined,
        });
    });

    it("updates the border color instead of removing it when a different active color is chosen", () => {
        const state: StickerImageEditState = {
            contentEraseStrokes: [],
            borderWidth: 6,
            borderColor: "#ef4444",
        };

        expect(toggleStickerBorder(state, "#22c55e")).toMatchObject({
            borderWidth: 6,
            borderColor: "#22c55e",
        });
    });
});
