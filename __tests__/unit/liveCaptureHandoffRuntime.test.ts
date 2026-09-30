import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveCaptureController } from "../../src/services/liveCaptureController";
import { refreshLiveCaptureHandoff } from "../../src/services/liveCaptureHandoff";
import { graphStore } from "../../src/store/graphStore";
import { liveCaptureViews } from "../../src/store/liveCaptureStore";
import { liveUnitStatus } from "../fixtures/liveUnit";
import type { LiveGpuSnapshot } from "../../src/services/liveGpuSnapshot";

const mocks = vi.hoisted(() => ({ poll: vi.fn(), read: vi.fn(), decode: vi.fn(), snapshot: vi.fn(), stop: vi.fn() }));
vi.mock("../../src/services/api", () => ({ isTauriRuntimeAvailable: () => false, api: {
    startLiveCapture: async () => liveUnitStatus(), setLiveCaptureInteractionEnabled: async () => liveUnitStatus(),
    debugLogEvent: vi.fn(), stopLiveCapture: mocks.stop, pollLiveCaptureFrame: mocks.poll, readLiveCaptureFrame: mocks.read,
} }));
vi.mock("../../src/services/liveGpuSnapshot", () => ({ readLiveGpuSnapshot: mocks.snapshot }));
vi.mock("../../src/services/liveCapturePresentation", async (original) => ({
    ...await original<typeof import("../../src/services/liveCapturePresentation")>(), decodeLiveFrame: mocks.decode,
}));
vi.mock("../../src/services/liveCaptureHandoff", async (original) => ({
    ...await original<typeof import("../../src/services/liveCaptureHandoff")>(), waitForLiveFallbackPaint: async () => undefined,
}));

const id = "live-runtime-test";
let controller: ReturnType<typeof createLiveCaptureController>;
const response = (frameId: number, capturedAtMs: number) => ({
    status: liveUnitStatus(), frame: { frameId, byteLength: 1, mime: "image/jpeg", captureTimestampMs: capturedAtMs },
});
beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("URL", class extends URL { static revokeObjectURL = vi.fn(); });
    mocks.poll.mockResolvedValue({ status: liveUnitStatus(), frame: null });
    mocks.read.mockResolvedValue(new Uint8Array([1]));
    mocks.decode.mockImplementation(async (_bytes: Uint8Array, mime: string) => `blob:${mime}`);
    mocks.snapshot.mockResolvedValue({ bytes: new Uint8Array([2]), capturedAtMs: 100 });
    mocks.stop.mockResolvedValue(undefined);
    controller = createLiveCaptureController();
});
afterEach(() => {
    controller.dispose();
    graphStore.actions.replaceUnits([]);
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
const start = async () => {
    mocks.poll.mockResolvedValueOnce(response(1, 10));
    await controller.start({ rect: { x: 0, y: 0, w: 160, h: 90 }, windowId: "123" });
    await vi.advanceTimersByTimeAsync(1);
};

describe("GPU-to-DOM transient handoff", () => {
    it("publishes retained pixels without persisting the streaming handoff, then preserves them on stop", async () => {
        await start();
        const initial = graphStore.units[0].data.src;
        await refreshLiveCaptureHandoff(id);
        expect(liveCaptureViews[0].imageUrl).toBe("blob:image/png");
        expect(liveCaptureViews[0].renderedFrameId).toBe(1);
        expect(graphStore.units[0].data.src).toBe(initial);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:image/jpeg");
        mocks.snapshot.mockResolvedValue(undefined);
        await controller.stop(id);
        expect(graphStore.units[0].data.src).toBe("data:image/png;base64,Ag==");
    });

    it.each([50, 100])("consumes a late JPEG at %i without replacing the newer/equal PNG", async (capturedAtMs) => {
        await start();
        let resolve!: (url: string) => void;
        mocks.decode.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; }));
        mocks.poll.mockResolvedValueOnce(response(2, capturedAtMs));
        await vi.advanceTimersByTimeAsync(100);
        await refreshLiveCaptureHandoff(id);
        resolve("blob:older-jpeg");
        await vi.advanceTimersByTimeAsync(1);
        expect(liveCaptureViews[0].imageUrl).toBe("blob:image/png");
        expect(liveCaptureViews[0].renderedFrameId).toBe(2);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:older-jpeg");
    });

    it("rejects an older snapshot when a newer JPEG arrived during readback", async () => {
        await start();
        let resolve!: (snapshot: LiveGpuSnapshot) => void;
        mocks.snapshot.mockImplementationOnce(() => new Promise<LiveGpuSnapshot>((done) => { resolve = done; }));
        const handoff = refreshLiveCaptureHandoff(id);
        await Promise.resolve();
        mocks.poll.mockResolvedValueOnce(response(2, 200));
        await vi.advanceTimersByTimeAsync(100);
        resolve({ bytes: new Uint8Array([2]), capturedAtMs: 100 });
        await handoff;
        expect(liveCaptureViews[0].imageUrl).toBe("blob:image/jpeg");
        expect(liveCaptureViews[0].renderedFrameId).toBe(2);
    });

    it("unregisters on disposal and cannot publish a late handoff", async () => {
        await start();
        let resolve!: (snapshot: LiveGpuSnapshot) => void;
        mocks.snapshot.mockImplementationOnce(() => new Promise<LiveGpuSnapshot>((done) => { resolve = done; }));
        const handoff = refreshLiveCaptureHandoff(id);
        expect(refreshLiveCaptureHandoff(id)).toBe(handoff);
        await Promise.resolve();
        controller.dispose();
        resolve({ bytes: new Uint8Array([2]), capturedAtMs: 100 });
        await handoff;
        await refreshLiveCaptureHandoff(id);
        expect(mocks.snapshot).toHaveBeenCalledOnce();
        expect(mocks.decode).toHaveBeenCalledOnce();
        expect(liveCaptureViews).toHaveLength(0);
    });
});
