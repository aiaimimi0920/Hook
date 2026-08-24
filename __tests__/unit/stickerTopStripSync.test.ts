import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    performWorkflowSync: vi.fn(),
    updateBackendRects: vi.fn(),
}));

vi.mock("../../src/services/syncService", () => ({
    syncService: {
        performWorkflowSync: state.performWorkflowSync,
        updateBackendRects: state.updateBackendRects,
    },
}));

import {
    syncStickerEditAfterLocalCommit,
    syncTopStripBackendRects,
} from "../../src/services/stickerTopStripSync";

const flushRejectionHandler = async () => {
    await Promise.resolve();
    await Promise.resolve();
};

describe("sticker top-strip background sync", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("reports a workflow failure after preserving the local edit", async () => {
        const error = new Error("workflow unavailable");
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        state.performWorkflowSync.mockRejectedValueOnce(error);

        expect(syncStickerEditAfterLocalCommit()).toBeUndefined();
        await flushRejectionHandler();

        expect(consoleError).toHaveBeenCalledWith(
            "[Hook] Failed to sync a committed sticker edit",
            error,
        );
        consoleError.mockRestore();
    });

    it("reports a rectangle sync failure from lifecycle work", async () => {
        const error = new Error("rect registry unavailable");
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        state.updateBackendRects.mockRejectedValueOnce(error);

        expect(syncTopStripBackendRects()).toBeUndefined();
        await flushRejectionHandler();

        expect(consoleError).toHaveBeenCalledWith("[Hook] Failed to sync top-strip rectangles", error);
        consoleError.mockRestore();
    });
});
