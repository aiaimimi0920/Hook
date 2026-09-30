import { describe, expect, it, vi } from "vitest";
import { SessionAssetReferences } from "../../src/services/sessionAssetReferences";
import type { SessionSticker } from "../../src/types/unit";

const sticker = (src = "data:image/png;base64,source"): SessionSticker => ({
    id: "one", src, previewSrc: "data:image/png;base64,preview", x: 0, y: 0, w: 10, h: 10,
});
const refs = [{ id: "one", src: "C:\\images\\source.png", previewSrc: "C:\\images\\preview.png" }];

describe("committed session image references", () => {
    it("sends image bytes once and only paths for coordinate edits without mutating UI/Loom data", async () => {
        const cache = new SessionAssetReferences();
        const original = sticker();
        const persist = vi.fn().mockResolvedValue({ documentRevision: 1, imageAssets: refs });
        await cache.save([original], persist);
        expect(persist.mock.calls[0][0][0]).toEqual(original);
        await cache.save([{ ...original, x: 300 }], persist);
        expect(persist.mock.calls[1][0][0]).toEqual({ ...original, ...refs[0], x: 300 });
        expect(persist.mock.calls[1][1]).toEqual([refs[0].src, refs[0].previewSrc]);
        expect(original.src).toBe("data:image/png;base64,source");
        expect(original.previewSrc).toBe("data:image/png;base64,preview");
    });

    it("sends new pixels and does not treat a failed save as committed", async () => {
        const cache = new SessionAssetReferences();
        await cache.save([sticker()], async () => ({ documentRevision: 1, imageAssets: refs }));
        const changed = sticker("data:image/png;base64,new");
        const failed = vi.fn().mockRejectedValue(new Error("disk full"));
        await expect(cache.save([changed], failed)).rejects.toThrow("disk full");
        const prepared = cache.prepare([changed]);
        expect(prepared.stickers[0].src).toBe(changed.src);
        expect(prepared.stickers[0].previewSrc).toBe(refs[0].previewSrc);
    });

    it("ignores responses older than a newer save and responses after workspace replacement", () => {
        const cache = new SessionAssetReferences();
        const old = cache.prepare([sticker()]);
        const freshSticker = sticker("data:image/png;base64,new");
        const fresh = cache.prepare([freshSticker]);
        cache.commit(fresh, [{ id: "one", src: "new.png" }]);
        cache.commit(old, refs);
        expect(cache.prepare([freshSticker]).stickers[0].src).toBe("new.png");
        const beforeClear = cache.prepare([sticker()]);
        cache.clear();
        cache.commit(beforeClear, refs);
        expect(cache.prepare([sticker()]).stickers[0].src).toBe(sticker().src);
    });

    it("releases removed unit references and tolerates legacy results without assets", async () => {
        const cache = new SessionAssetReferences();
        await cache.save([sticker()], async () => ({ documentRevision: 1, imageAssets: refs }));
        cache.prepare([]);
        expect(cache.prepare([sticker()]).stickers[0].src).toBe(sticker().src);
        await cache.save([sticker()], async () => ({ documentRevision: 2 }));
        expect(cache.prepare([sticker()]).stickers[0].src).toBe(sticker().src);
    });

    it("restores deleted cache files from pixels once without retrying a revision conflict", async () => {
        const cache = new SessionAssetReferences();
        await cache.save([sticker()], async () => ({ documentRevision: 1, imageAssets: refs }));
        const persist = vi.fn()
            .mockRejectedValueOnce(new Error("SESSION_ASSET_MISSING"))
            .mockResolvedValueOnce({ documentRevision: 2, imageAssets: refs });
        await cache.save([sticker()], persist);
        expect(persist).toHaveBeenCalledTimes(2);
        expect(persist.mock.calls[0][0][0].src).toBe(refs[0].src);
        expect(persist.mock.calls[1][0][0].src).toBe(sticker().src);
        expect(persist.mock.calls[1][1]).toEqual([]);
        const conflict = vi.fn().mockRejectedValue(new Error("SESSION_REVISION_CONFLICT"));
        await expect(cache.save([sticker()], conflict)).rejects.toThrow("SESSION_REVISION_CONFLICT");
        expect(conflict).toHaveBeenCalledTimes(1);
    });

    it("does not retry obsolete pixels if the workspace changes during a failed save", async () => {
        const cache = new SessionAssetReferences();
        const persist = vi.fn().mockImplementation(async () => {
            cache.clear();
            throw new Error("SESSION_ASSET_MISSING");
        });
        await expect(cache.save([sticker()], persist)).rejects.toThrow("SESSION_ASSET_MISSING");
        expect(persist).toHaveBeenCalledTimes(1);
    });
});
