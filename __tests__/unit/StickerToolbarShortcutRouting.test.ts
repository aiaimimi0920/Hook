import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toggleSelectedStickerToolbar } from "../../src/services/stickerToolbarShortcutRouting";

describe("sticker toolbar shortcut routing", () => {
    let clock = 0;
    beforeEach(() => {
        clock += 1_000;
        vi.spyOn(performance, "now").mockReturnValue(clock);
    });
    afterEach(() => vi.restoreAllMocks());
    it("opens the toolbar once and refreshes the native hit map", () => {
        const toggleToolbar = vi.fn();
        const refreshHitTest = vi.fn();

        toggleSelectedStickerToolbar({ fallback: toggleToolbar, refreshHitTest });

        expect(toggleToolbar).toHaveBeenCalledOnce();
        expect(refreshHitTest).toHaveBeenCalledOnce();
    });
    it("refreshes the native hit map after an asynchronous Live edit entry", async () => {
        let resolve!: () => void;
        const pending = new Promise<void>((done) => { resolve = done; });
        const refreshHitTest = vi.fn();
        toggleSelectedStickerToolbar({ fallback: () => pending, refreshHitTest });
        expect(refreshHitTest).not.toHaveBeenCalled();
        resolve();
        await pending;
        expect(refreshHitTest).toHaveBeenCalledOnce();
    });
});
