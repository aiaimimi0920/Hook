import { beforeEach, describe, expect, it } from "vitest";

import { createDefaultStickerToolSettings } from "../../src/services/stickerEditing";
import { stickerToolSettings, uiActions } from "../../src/store/uiStore";

describe("sticker editing domain state", () => {
    beforeEach(() => {
        uiActions.setStickerToolSettings(createDefaultStickerToolSettings());
    });

    it("does not keep content eraser armed when re-entering the whole-sticker domain", () => {
        uiActions.setStickerCanvasTool("content-eraser");
        expect(stickerToolSettings.domain).toBe("sticker");
        expect(stickerToolSettings.activeCanvasTool).toBe("content-eraser");

        uiActions.setStickerEditingDomain("create");
        uiActions.setStickerEditingDomain("sticker");

        expect(stickerToolSettings.domain).toBe("sticker");
        expect(stickerToolSettings.activeCanvasTool).toBe("idle");
        expect(stickerToolSettings.mode).toBe("idle");
    });
});
