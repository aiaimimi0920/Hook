import { describe, expect, it, vi } from "vitest";

import { toggleSelectedStickerToolbar } from "../../src/services/stickerToolbarShortcutRouting";

describe("sticker toolbar shortcut routing", () => {
    it("opens the toolbar once and refreshes the native hit map", () => {
        const toggleToolbar = vi.fn();
        const refreshHitTest = vi.fn();

        toggleSelectedStickerToolbar({ fallback: toggleToolbar, refreshHitTest });

        expect(toggleToolbar).toHaveBeenCalledOnce();
        expect(refreshHitTest).toHaveBeenCalledOnce();
    });
});
