import { describe, expect, it, vi } from "vitest";

import { toggleSelectedStickerToolbar } from "../../src/services/ocrShortcutRouting";
import { ocrInteractiveUnitId, uiActions } from "../../src/store/uiStore";

describe("sticker toolbar shortcut routing", () => {
    it("opens the toolbar route without disabling an active OCR overlay", () => {
        const toggleToolbar = vi.fn();
        const refreshHitTest = vi.fn();
        uiActions.setOcrInteractiveUnit("ocr-unit");

        toggleSelectedStickerToolbar({ fallback: toggleToolbar, refreshHitTest });

        expect(toggleToolbar).toHaveBeenCalledOnce();
        expect(refreshHitTest).toHaveBeenCalledOnce();
        expect(ocrInteractiveUnitId()).toBe("ocr-unit");
        uiActions.clearOcrInteractiveUnit("ocr-unit");
    });
});
