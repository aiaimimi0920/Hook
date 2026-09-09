import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveCaptureController } from "../../src/services/liveCaptureController";
import { graphStore } from "../../src/store/graphStore";
import { liveCaptureViews } from "../../src/store/liveCaptureStore";
import { liveUnitStatus } from "../fixtures/liveUnit";

const mocks = vi.hoisted(() => ({ poll: vi.fn(), read: vi.fn(), decode: vi.fn(), stop: vi.fn() }));
vi.mock("../../src/services/api", () => ({ isTauriRuntimeAvailable: () => false, api: {
    startLiveCapture: async () => ({ ...liveUnitStatus(), targetFps: 60 }),
    setLiveCaptureInteractionEnabled: async () => ({ ...liveUnitStatus(), targetFps: 60 }),
    debugLogEvent: vi.fn().mockResolvedValue(undefined), stopLiveCapture: mocks.stop,
    pollLiveCaptureFrame: mocks.poll, readLiveCaptureFrame: mocks.read,
} }));
vi.mock("../../src/services/liveCapturePresentation", async (original) => ({
    ...await original<typeof import("../../src/services/liveCapturePresentation")>(), decodeLiveFrame: mocks.decode,
}));
let controller: ReturnType<typeof createLiveCaptureController>;
beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubGlobal("URL", class extends URL { static revokeObjectURL = vi.fn(); });
    mocks.stop.mockResolvedValue(undefined);
    mocks.read.mockResolvedValue(new Uint8Array([1]));
    mocks.decode.mockResolvedValue("blob:ready");
    controller = createLiveCaptureController();
});
afterEach(() => {
    controller.dispose();
    graphStore.actions.replaceUnits([]);
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks();
});
const start = () => controller.start({ rect: { x: 0, y: 0, w: 160, h: 90 }, windowId: "123" });
const response = (frameId: number) => ({
    status: { ...liveUnitStatus(), targetFps: 60, frameId },
    frame: { frameId, byteLength: 1, mime: "image/jpeg" },
});

describe("Live controller video cadence and cancellation", () => {
    it("keeps one poll in flight and includes work in, rather than after, its frame budget", async () => {
        const times: number[] = [];
        let inFlight = 0;
        let maxInFlight = 0;
        mocks.poll.mockImplementation(async () => {
            times.push(performance.now()); maxInFlight = Math.max(maxInFlight, ++inFlight);
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            inFlight--;
            return response(times.length);
        });
        await start();
        await vi.advanceTimersByTimeAsync(100);
        expect(times.length).toBeGreaterThanOrEqual(6);
        expect(times.length).toBeLessThanOrEqual(7);
        expect(times[1] - times[0]).toBeLessThanOrEqual(17);
        expect(maxInFlight).toBe(1);
    });

    it("does not turn over-budget frames into concurrent or millisecond-rate IPC polling", async () => {
        const times: number[] = [];
        mocks.poll.mockImplementation(async () => {
            times.push(performance.now());
            await new Promise<void>((resolve) => setTimeout(resolve, 30));
            return response(times.length);
        });
        await start();
        await vi.advanceTimersByTimeAsync(100);
        expect(times.length).toBe(4);
        expect(times[1] - times[0]).toBeGreaterThanOrEqual(31);
    });

    it("releases a late decoded URL and does not publish or restart after stop", async () => {
        let decoded!: (url: string) => void;
        mocks.decode.mockImplementation(() => new Promise<string>((resolve) => { decoded = resolve; }));
        mocks.poll.mockResolvedValue(response(1));
        await start();
        await vi.advanceTimersByTimeAsync(1);
        expect(liveCaptureViews[0].imageUrl).toBeUndefined();
        await controller.stop("live-runtime-test");
        decoded("blob:late");
        await vi.advanceTimersByTimeAsync(100);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:late");
        expect(liveCaptureViews).toHaveLength(0);
        expect(mocks.poll).toHaveBeenCalledTimes(1);
    });
});
