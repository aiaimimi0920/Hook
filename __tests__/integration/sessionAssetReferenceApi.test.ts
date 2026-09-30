import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionHistoryApi } from "../../src/services/apiSessionHistory";
import { clearAllSyncImageCaches } from "../../src/services/syncImageCache";
import type { SessionSticker } from "../../src/types/unit";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const original: SessionSticker = {
    id: "image", src: "data:image/png;base64,original", previewSrc: "data:image/png;base64,edited",
    x: 0, y: 0, w: 10, h: 10,
};
const committed = { id: original.id, src: "C:\\Hook\\images\\source.png", previewSrc: "C:\\Hook\\images\\preview.png" };

describe("native persistence asset reference contract", () => {
    beforeEach(() => {
        clearAllSyncImageCaches();
        invoke.mockReset();
        vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    });
    afterEach(() => { vi.unstubAllGlobals(); clearAllSyncImageCaches(); });

    it("hands back committed references while retaining exact CAS revisions and original pixels", async () => {
        invoke.mockResolvedValueOnce({ documentRevision: 4, imageAssets: [committed] });
        await sessionHistoryApi.saveSession([original], [], [], [], [], { workflows: {} }, 3);
        invoke.mockResolvedValueOnce({ documentRevision: 5 });
        await sessionHistoryApi.saveSession([{ ...original, x: 70 }], [], [], [], [], { workflows: {} }, 4);
        expect(invoke.mock.calls[0][1]).toMatchObject({ expectedDocumentRevision: 3, stickers: [original] });
        expect(invoke.mock.calls[1][1]).toMatchObject({
            expectedDocumentRevision: 4,
            stickers: [{ ...original, ...committed, x: 70 }],
            managedAssetPaths: [committed.src, committed.previewSrc],
        });
        expect(original.src).toBe("data:image/png;base64,original");
        clearAllSyncImageCaches();
        invoke.mockResolvedValueOnce({ documentRevision: 6 });
        await sessionHistoryApi.saveSession([original], [], [], [], [], { workflows: {} }, 5);
        expect(invoke.mock.calls[2][1]).toMatchObject({ stickers: [original], managedAssetPaths: [] });
    });

    it("retries lost native assets with full pixels at the unchanged expected revision", async () => {
        invoke.mockResolvedValueOnce({ documentRevision: 1, imageAssets: [committed] });
        await sessionHistoryApi.saveSession([original], [], [], [], [], { workflows: {} }, 0);
        invoke.mockRejectedValueOnce("SESSION_ASSET_MISSING").mockResolvedValueOnce({ documentRevision: 2 });
        await sessionHistoryApi.saveSession([original], [], [], [], [], { workflows: {} }, 1);
        expect(invoke).toHaveBeenCalledTimes(3);
        expect(invoke.mock.calls[1][1]).toMatchObject({ expectedDocumentRevision: 1, stickers: [{ ...original, ...committed }] });
        expect(invoke.mock.calls[2][1]).toMatchObject({ expectedDocumentRevision: 1, stickers: [original], managedAssetPaths: [] });
    });
});
