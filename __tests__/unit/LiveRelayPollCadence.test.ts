import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/services/api";
import { createLiveRelayController, type LiveRelayController } from "../../src/services/liveRelayController";
import type { LiveRelayFrameDescriptor, LiveRelaySessionSummary, LiveRelaySnapshot } from "../../src/services/liveRelay";
import { liveRelayActions, liveRelayViews } from "../../src/store/liveRelayStore";

vi.mock("../../src/services/api", () => ({ api: {
    joinLiveRelaySession: vi.fn(), pollLiveRelayFrame: vi.fn(), readLiveRelayFrame: vi.fn(),
    stopLiveRelaySession: vi.fn(), publishLiveCaptureToLoom: vi.fn(),
    discoverLiveRelaySessions: vi.fn(), getLiveRelayStatus: vi.fn(),
} }));

const status: LiveRelaySnapshot = {
    relayId: "relay:a", liveSessionId: "live:a", role: "viewer", connectionState: "connected",
    epoch: 1, lastFrameId: 0, receivedFrames: 0, reconnectCount: 0, overwrittenFrames: 0,
    controllerOwned: false, remoteControlActive: false, lastInputSequence: 0,
    mediaTransport: "websocket_binary", networkScope: "loopback_http", latencyState: "unavailable",
    observationCapabilities: [], observationState: "unsupported", observations: [], triggers: [], triggerAudits: [],
};
const session: LiveRelaySessionSummary = {
    session: {
        sessionId: "live:a", sourceDeviceId: "source:a", sourceHookId: "hook:a", sourceKind: "region",
        sourceWindowIdentity: {}, frameStream: { width: 1, height: 1, targetFps: 30 },
        interactionCapabilities: [], observationCapabilities: [], triggerBindings: [], viewerDevices: [],
    },
    epoch: 1, sourceConnected: true, closed: false,
};
const frame = (frameId: number): LiveRelayFrameDescriptor => ({
    relayId: status.relayId, liveSessionId: status.liveSessionId, epoch: 1, frameId,
    captureTimestampMs: 0, encodeTimestampMs: 0, receivedTimestampMs: 0,
    width: 1, height: 1, codec: "raw_bgra", colorSpace: "srgb", byteLength: 4, droppedFrames: 0,
});
let controller: LiveRelayController;
const join = () => controller.join(session, { unitId: "unit:a", instanceId: "instance:a", attachmentId: "attachment:a", label: "A" });
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks(); liveRelayActions.clear();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:frame");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.mocked(api.joinLiveRelaySession).mockResolvedValue({ ...status });
    vi.mocked(api.stopLiveRelaySession).mockResolvedValue(undefined);
    vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status: { ...status } });
    vi.mocked(api.readLiveRelayFrame).mockResolvedValue(new Uint8Array(4));
    vi.stubGlobal("Image", class { src = ""; naturalWidth = 1; naturalHeight = 1; decode() { return Promise.resolve(); } });
    controller = createLiveRelayController();
});
afterEach(() => {
    controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("LiveRelay viewer cadence", () => {
    it("includes poll and frame-read time in the 80ms interval", async () => {
        vi.mocked(api.pollLiveRelayFrame).mockImplementation(async () => {
            await wait(10); return { status, frame: frame(1) };
        });
        vi.mocked(api.readLiveRelayFrame).mockImplementation(async () => {
            await wait(20); return new Uint8Array(4);
        });
        await join(); await vi.advanceTimersByTimeAsync(79);
        expect(liveRelayViews[0].submittedFrameId).toBe(1);
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(api.pollLiveRelayFrame).toHaveBeenLastCalledWith(status.relayId, 1);
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(2);
    });

    it("does not overlap slow reads or accumulate catch-up requests", async () => {
        vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status, frame: frame(1) });
        vi.mocked(api.readLiveRelayFrame).mockImplementation(async () => {
            await wait(200); return new Uint8Array(4);
        });
        await join(); await vi.advanceTimersByTimeAsync(200);
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(2);
        expect(api.readLiveRelayFrame).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);
    });

    it("keeps empty polling bounded and skips unchanged frames", async () => {
        await join(); await vi.advanceTimersByTimeAsync(800);
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(11);
        expect(api.readLiveRelayFrame).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(1);
    });

    it("preserves the 500ms error backoff after a slow failed poll", async () => {
        vi.mocked(api.pollLiveRelayFrame).mockImplementation(async () => {
            await wait(20); throw new Error("offline");
        });
        await join(); await vi.advanceTimersByTimeAsync(519);
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(2);
    });

    it("retries an evicted frame at the bounded cadence", async () => {
        vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status, frame: frame(1) });
        vi.mocked(api.readLiveRelayFrame).mockImplementation(async () => {
            await wait(20); throw new Error("live relay frame was evicted");
        });
        await join(); await vi.advanceTimersByTimeAsync(80);
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(2);
        expect(liveRelayViews[0].submittedFrameId).toBe(0);
    });

    it.each(["stop", "dispose"] as const)("rejects late read output after %s", async (action) => {
        vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status, frame: frame(1) });
        vi.mocked(api.readLiveRelayFrame).mockImplementation(async () => {
            await wait(30); return new Uint8Array(4);
        });
        await join(); await vi.advanceTimersByTimeAsync(10);
        if (action === "stop") await controller.stop(status.relayId);
        else controller.dispose();
        await vi.advanceTimersByTimeAsync(1000);
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(1);
        expect(liveRelayViews).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("clears the displayed frame and stops scheduling on closed status", async () => {
        vi.mocked(api.pollLiveRelayFrame).mockResolvedValueOnce({ status, frame: frame(1) })
            .mockResolvedValue({ status: { ...status, connectionState: "closed" } });
        await join(); await vi.advanceTimersByTimeAsync(1000);
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(2);
        expect(liveRelayViews[0].imageUrl).toBeUndefined();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:frame");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("preserves the source status interval", async () => {
        const source = { ...status, role: "source" as const };
        vi.mocked(api.publishLiveCaptureToLoom).mockResolvedValue(source);
        vi.mocked(api.discoverLiveRelaySessions).mockResolvedValue({ protocolVersion: "loom.live.v1", sessions: [] });
        vi.mocked(api.getLiveRelayStatus).mockImplementation(async () => { await wait(20); return source; });
        await controller.publish("capture:a", "Source", { width: 1, height: 1 });
        await vi.advanceTimersByTimeAsync(419);
        expect(api.getLiveRelayStatus).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(api.getLiveRelayStatus).toHaveBeenCalledTimes(2);
    });

    // Runs against either controller revision: this measures synthetic scheduling,
    // not native IPC, browser decoding, network throughput, or physical display.
    it.each([0, 20, 100])("measures synthetic 30fps freshness with %ims read work", async (workMs) => {
        const start = Date.now();
        const updates: number[] = [], ages: number[] = [];
        let inFlight = 0, maxInFlight = 0;
        vi.mocked(api.pollLiveRelayFrame).mockImplementation(async (_id, afterId) => {
            const id = Math.floor((Date.now() - start) / (1000 / 30)) + 1;
            return { status, frame: id > afterId ? frame(id) : undefined };
        });
        vi.mocked(api.readLiveRelayFrame).mockImplementation(async () => {
            maxInFlight = Math.max(maxInFlight, ++inFlight);
            await wait(workMs); --inFlight; updates.push(Date.now() - start);
            return new Uint8Array(4);
        });
        await join();
        for (let tick = 0; tick < 1000; tick++) {
            await vi.advanceTimersByTimeAsync(10);
            const id = liveRelayViews[0]?.submittedFrameId;
            if (id && tick >= 100) ages.push(Date.now() - start - (id - 1) * (1000 / 30));
        }
        const intervals = updates.slice(1).map((time, i) => time - updates[i]).sort((a, b) => a - b);
        ages.sort((a, b) => a - b);
        const percentile = (values: number[], p: number) => Number(values[Math.floor((values.length - 1) * p)].toFixed(2));
        console.info(JSON.stringify({ scope: "synthetic-controller-store", workMs, updates: updates.length,
            intervalP50: percentile(intervals, 0.5), intervalP95: percentile(intervals, 0.95),
            ageP50: percentile(ages, 0.5), ageP95: percentile(ages, 0.95), maxInFlight }));
        expect(maxInFlight).toBe(1);
        expect(Math.min(...intervals)).toBeGreaterThanOrEqual(80);
    });
});
