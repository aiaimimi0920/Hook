import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { graphStore } from "../../src/store/graphStore";
import { clipboard, setClipboard, uiActions } from "../../src/store/uiStore";
import { useClipboard } from "../../src/hooks/useClipboard";
import { liveUnitStatus } from "../fixtures/liveUnit";
import type { LiveCaptureView } from "../../src/services/liveCapture";
import type { LiveGpuSnapshot } from "../../src/services/liveGpuSnapshot";
import { renderStickerComposite } from "../../src/services/stickerExport";
import { attachLiveCaptureUnit, commitLiveCaptureUnitFrame, detachLiveCaptureUnit,
    prepareLiveCaptureUnitSnapshot, updateLiveCaptureUnitFrame } from "../../src/services/liveCaptureUnit";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), copy: vi.fn() }));
vi.mock("../../src/services/liveGpuSnapshot", () => ({ readLiveGpuSnapshot: mocks.snapshot }));
vi.mock("../../src/services/api", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../src/services/api")>();
    return { ...original, api: { ...original.api, copyStickerImageToSmartClipboard: mocks.copy } };
});

const id = "live-snapshot-test";
const source = () => graphStore.units.find((unit) => unit.id === id)?.data.src;
const snapshot = (capturedAtMs = 20): LiveGpuSnapshot => ({ bytes: new Uint8Array([4, 5, 6]), capturedAtMs });
const attach = () => {
    const view: LiveCaptureView = { sessionId: id, x: 10, y: 20, width: 100, height: 50,
        renderedFrameId: 1, status: { ...liveUnitStatus(), sessionId: id } };
    attachLiveCaptureUnit(view, async () => undefined);
    updateLiveCaptureUnitFrame(id, new Uint8Array([1, 2, 3]), "image/jpeg", 1, 10);
};
beforeEach(() => {
    uiActions.hideStickerToolbar();
    mocks.snapshot.mockReset().mockResolvedValue(snapshot());
    mocks.copy.mockReset().mockResolvedValue("C:\\temp\\snapshot.png");
    attach();
});
afterEach(() => {
    uiActions.hideStickerToolbar();
    detachLiveCaptureUnit(id);
    graphStore.actions.replaceUnits([]);
    setClipboard(null);
});

describe("Live GPU explicit snapshot boundaries", () => {
    it("uses one prepared snapshot for both internal and system clipboards", async () => {
        await useClipboard().handleCopy();
        expect(clipboard()?.src).toBe("data:image/png;base64,BAUG");
        expect(mocks.copy.mock.calls[0][0]).toBe(clipboard()?.src);
        expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    });
    it("exports a fresh snapshot even when supplied an old captured Unit object", async () => {
        const previous = graphStore.units.find((unit) => unit.id === id)!;
        const frozen = { ...previous, data: { ...previous.data } };
        expect(await renderStickerComposite(frozen)).toBe("data:image/png;base64,BAUG");
        expect(frozen.data.src).toBe("data:image/jpeg;base64,AQID");
    });
    it("invalidates a previously exported file when new pixels are committed", async () => {
        graphStore.actions.updateUnitData(id, { dragOutFilePath: "C:\\temp\\stale.png" });
        await prepareLiveCaptureUnitSnapshot(id);
        expect(graphStore.units.find((unit) => unit.id === id)?.data.dragOutFilePath).toBeUndefined();
    });
    it("commits a new PNG even when the continuous JPEG sequence has not advanced", async () => {
        expect(source()).toBe("data:image/jpeg;base64,AQID");
        expect(await prepareLiveCaptureUnitSnapshot(id)).toBe("data:image/png;base64,BAUG");
        expect(source()).toBe("data:image/png;base64,BAUG");
        commitLiveCaptureUnitFrame(id);
        expect(source()).toBe("data:image/png;base64,BAUG");
    });
    it("coalesces concurrent snapshot consumers without serializing capabilities into Unit data", async () => {
        const first = prepareLiveCaptureUnitSnapshot(id);
        expect(prepareLiveCaptureUnitSnapshot(id)).toBe(first);
        await first;
        expect(mocks.snapshot).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(graphStore.units[0].data)).not.toMatch(/snapshotAtMs|sessionId|snapshot/);
    });
    it("keeps the current JPEG when native preview is unavailable", async () => {
        mocks.snapshot.mockResolvedValue(undefined);
        await prepareLiveCaptureUnitSnapshot(id);
        expect(source()).toBe("data:image/jpeg;base64,AQID");
    });
    it("never overwrites the visible edit snapshot", async () => {
        uiActions.showStickerToolbar(id);
        expect(prepareLiveCaptureUnitSnapshot(id)).toBeUndefined();
        expect(mocks.snapshot).not.toHaveBeenCalled();
        expect(source()).toBe("data:image/jpeg;base64,AQID");
    });
    it("ignores a readback if editing started while it was in flight", async () => {
        let resolve!: (frame: LiveGpuSnapshot) => void;
        mocks.snapshot.mockReturnValue(new Promise<LiveGpuSnapshot>((done) => { resolve = done; }));
        const pending = prepareLiveCaptureUnitSnapshot(id);
        uiActions.showStickerToolbar(id);
        resolve(snapshot());
        expect(await pending).toBeUndefined();
        expect(source()).toBe("data:image/jpeg;base64,AQID");
    });
    it("does not let an old JPEG overwrite the newer explicit GPU snapshot", async () => {
        await prepareLiveCaptureUnitSnapshot(id);
        updateLiveCaptureUnitFrame(id, new Uint8Array([7]), "image/jpeg", 2, 15);
        commitLiveCaptureUnitFrame(id);
        expect(source()).toBe("data:image/png;base64,BAUG");
        updateLiveCaptureUnitFrame(id, new Uint8Array([8]), "image/jpeg", 3, 30);
        commitLiveCaptureUnitFrame(id);
        expect(source()).toBe("data:image/jpeg;base64,CA==");
    });
    it("keeps a newer JPEG if the GPU snapshot predates it", async () => {
        updateLiveCaptureUnitFrame(id, new Uint8Array([8]), "image/jpeg", 2, 30);
        await prepareLiveCaptureUnitSnapshot(id);
        expect(source()).toBe("data:image/jpeg;base64,CA==");
    });
    it("rejects a late snapshot for a detached/replaced binding", async () => {
        let resolve!: (frame: LiveGpuSnapshot) => void;
        mocks.snapshot.mockReturnValue(new Promise<LiveGpuSnapshot>((done) => { resolve = done; }));
        const pending = prepareLiveCaptureUnitSnapshot(id)!;
        const result = expect(pending).rejects.toThrow(/ended/);
        detachLiveCaptureUnit(id);
        graphStore.actions.removeUnit(id);
        attach();
        resolve(snapshot());
        await result;
        expect(source()).toBe("data:image/jpeg;base64,AQID");
    });
    it("does not silently export stale pixels on a native snapshot failure", async () => {
        mocks.snapshot.mockRejectedValueOnce(new Error("GPU snapshot requests are busy"));
        await expect(prepareLiveCaptureUnitSnapshot(id)).rejects.toThrow(/busy/);
        expect(source()).toBe("data:image/jpeg;base64,AQID");
        await prepareLiveCaptureUnitSnapshot(id);
        expect(source()).toBe("data:image/png;base64,BAUG");
    });
    it("does no asynchronous work for an ordinary Unit", () => {
        expect(prepareLiveCaptureUnitSnapshot("ordinary")).toBeUndefined();
        expect(mocks.snapshot).not.toHaveBeenCalled();
    });
});
