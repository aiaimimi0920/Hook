import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    getInstalledFonts: vi.fn(),
    setInstalledStickerFonts: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
    api: { getInstalledFonts: state.getInstalledFonts },
}));

vi.mock("../../src/store/uiStore", () => ({
    setInstalledStickerFonts: state.setInstalledStickerFonts,
}));

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

describe("installed sticker font loader", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    it("shares one pending request and caches a successful global result", async () => {
        const result = deferred<string[]>();
        state.getInstalledFonts.mockReturnValueOnce(result.promise);
        const { loadInstalledStickerFonts } = await import("../../src/services/installedStickerFontLoader");

        const first = loadInstalledStickerFonts();
        const overlapping = loadInstalledStickerFonts();
        expect(state.getInstalledFonts).toHaveBeenCalledOnce();

        result.resolve(["Font A", "Font B"]);
        await Promise.all([first, overlapping]);
        await loadInstalledStickerFonts();
        expect(state.getInstalledFonts).toHaveBeenCalledOnce();
        expect(state.setInstalledStickerFonts).toHaveBeenCalledWith(["Font A", "Font B"]);
    });

    it("clears a failed pending request so a later demand can retry", async () => {
        state.getInstalledFonts
            .mockRejectedValueOnce(new Error("font lookup failed"))
            .mockResolvedValueOnce(["Recovered Font"]);
        const { loadInstalledStickerFonts } = await import("../../src/services/installedStickerFontLoader");

        await expect(loadInstalledStickerFonts()).rejects.toThrow("font lookup failed");
        await expect(loadInstalledStickerFonts()).resolves.toBeUndefined();
        expect(state.getInstalledFonts).toHaveBeenCalledTimes(2);
        expect(state.setInstalledStickerFonts).toHaveBeenCalledWith(["Recovered Font"]);
    });
});
