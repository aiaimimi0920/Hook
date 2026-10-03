import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/services/api";
import { createLiveRelayController, type LiveRelayController } from "../../src/services/liveRelayController";
import type { LiveRelayFrameDescriptor, LiveRelaySessionSummary, LiveRelaySnapshot } from "../../src/services/liveRelay";
import { liveRelayActions, liveRelayViews } from "../../src/store/liveRelayStore";

vi.mock("../../src/services/api", () => ({ api: {
    joinLiveRelaySession: vi.fn(), pollLiveRelayFrame: vi.fn(), readLiveRelayFrame: vi.fn(),
    stopLiveRelaySession: vi.fn(),
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
    }, epoch: 1, sourceConnected: true, closed: false,
};
const frame = (frameId: number): LiveRelayFrameDescriptor => ({
    relayId: status.relayId, liveSessionId: status.liveSessionId, epoch: 1, frameId,
    captureTimestampMs: 1, encodeTimestampMs: 2, receivedTimestampMs: 3,
    width: 1, height: 1, codec: "raw_bgra", colorSpace: "srgb", byteLength: 4, droppedFrames: 0,
});
const decode = vi.fn<() => Promise<void>>();
const images: Array<{ src: string }> = [];
let controller: LiveRelayController;
let finishDecode: () => void;
const join = () => controller.join(session, { unitId: "unit:a", instanceId: "instance:a", attachmentId: "attachment:a", label: "A" });

beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks(); liveRelayActions.clear(); images.length = 0;
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    let nextUrl = 0;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:frame-${++nextUrl}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.stubGlobal("Image", class {
        src = ""; naturalWidth = 1; naturalHeight = 1;
        constructor() { images.push(this); }
        decode() { return decode(); }
    });
    decode.mockImplementation(() => new Promise<void>((resolve) => { finishDecode = resolve; }));
    vi.mocked(api.joinLiveRelaySession).mockResolvedValue({ ...status });
    vi.mocked(api.stopLiveRelaySession).mockResolvedValue(undefined);
    vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status: { ...status }, frame: frame(1) });
    vi.mocked(api.readLiveRelayFrame).mockResolvedValue(new Uint8Array(4));
    controller = createLiveRelayController();
});
afterEach(() => {
    controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("LiveRelay decoded submission", () => {
    it("does not replace pixels or claim progress before decoding completes", async () => {
        await join(); await vi.advanceTimersByTimeAsync(20);
        expect(liveRelayViews[0].imageUrl).toBeUndefined();
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(1);
        finishDecode(); await vi.advanceTimersByTimeAsync(1);
        expect(liveRelayViews[0].imageUrl).toBe("blob:frame-1");
        expect(liveRelayViews[0].submittedFrameId).toBe(1);
        expect(liveRelayViews[0].presentation).toMatchObject({
            liveSessionId: "live:a", epoch: 1, frameId: 1, evidence: "decoded_submitted",
            payloadBytes: 4, bitmapBytes: 58, decodeMs: 20,
        });
    });

    it("keeps the previous decoded frame until the replacement is ready", async () => {
        decode.mockResolvedValueOnce(undefined);
        await join(); await vi.advanceTimersByTimeAsync(1);
        vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status, frame: frame(2) });
        await vi.advanceTimersByTimeAsync(100);
        expect(liveRelayViews[0].imageUrl).toBe("blob:frame-1");
        expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:frame-1");
        finishDecode(); await vi.advanceTimersByTimeAsync(1);
        expect(liveRelayViews[0].imageUrl).toBe("blob:frame-2");
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:frame-1");
    });

    it.each(["stop", "dispose"] as const)("cancels the decoder and rejects late output after %s", async (action) => {
        await join(); await vi.advanceTimersByTimeAsync(1);
        if (action === "stop") await controller.stop(status.relayId);
        else controller.dispose();
        finishDecode(); await vi.advanceTimersByTimeAsync(2000);
        expect(images[0].src).toBe("");
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(liveRelayViews).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("bounds a stalled decoder and keeps the poll retry path alive", async () => {
        await join(); await vi.advanceTimersByTimeAsync(1001);
        expect(liveRelayViews[0].imageUrl).toBeUndefined();
        expect(liveRelayViews[0].controlError).toBe("live_relay_decode_timeout");
        expect(images[0].src).toBe("");
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:frame-1");
        finishDecode(); await vi.advanceTimersByTimeAsync(500);
        expect(liveRelayViews[0].imageUrl).toBeUndefined();
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(2);
    });

    it("rejects broken decodes without reporting a submitted frame", async () => {
        decode.mockRejectedValue(new Error("decoder failed"));
        await join(); await vi.advanceTimersByTimeAsync(1);
        expect(liveRelayViews[0].submittedFrameId).toBe(0);
        expect(liveRelayViews[0].presentation).toBeUndefined();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:frame-1");
    });

    it.each([
        { liveSessionId: "live:other" }, { relayId: "relay:other" }, { epoch: 2 },
        { codec: "h264" }, { colorSpace: "hdr10" }, { width: 16385 }, { byteLength: 5 },
    ])("rejects mismatched identity or unsupported pixels before reading: %o", async (change) => {
        vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status, frame: { ...frame(1), ...change } as LiveRelayFrameDescriptor });
        await join(); await vi.advanceTimersByTimeAsync(1);
        expect(api.readLiveRelayFrame).not.toHaveBeenCalled();
        expect(liveRelayViews[0].presentation).toBeUndefined();
    });

    it("does not submit a decode when the session closes during decoding", async () => {
        await join(); await vi.advanceTimersByTimeAsync(1);
        liveRelayActions.updateStatus(status.relayId, { ...status, connectionState: "closed" });
        finishDecode(); await vi.advanceTimersByTimeAsync(1000);
        expect(liveRelayViews[0].imageUrl).toBeUndefined();
        expect(liveRelayViews[0].presentation).toBeUndefined();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:frame-1");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("accepts a lower frame ID only after an epoch change clears the cursor", async () => {
        decode.mockResolvedValue(undefined);
        vi.mocked(api.pollLiveRelayFrame).mockResolvedValueOnce({ status, frame: frame(99) })
            .mockResolvedValue({ status: { ...status, epoch: 2 }, frame: { ...frame(1), epoch: 2 } });
        await join(); await vi.advanceTimersByTimeAsync(81);
        expect(liveRelayViews[0].submittedFrameId).toBe(1);
        expect(liveRelayViews[0].presentation?.epoch).toBe(2);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:frame-1");
    });

    it("never decodes a frame delivered together with a closed status", async () => {
        vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status: { ...status, connectionState: "closed" }, frame: frame(1) });
        await join(); await vi.advanceTimersByTimeAsync(1000);
        expect(api.readLiveRelayFrame).not.toHaveBeenCalled();
        expect(decode).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("stopping one stalled viewer does not cancel another viewer's pixels", async () => {
        await join(); await vi.advanceTimersByTimeAsync(1);
        const finishFirst = finishDecode;
        const second = { ...status, relayId: "relay:b", liveSessionId: "live:b" };
        vi.mocked(api.joinLiveRelaySession).mockResolvedValue(second);
        vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status: second, frame: { ...frame(1), relayId: second.relayId, liveSessionId: second.liveSessionId } });
        decode.mockResolvedValue(undefined);
        await controller.join({ ...session, session: { ...session.session, sessionId: "live:b" } }, { unitId: "unit:b", instanceId: "instance:b", attachmentId: "attachment:b", label: "B" });
        await vi.advanceTimersByTimeAsync(1);
        await controller.stop("relay:a"); finishFirst(); await vi.advanceTimersByTimeAsync(1);
        expect(liveRelayViews).toHaveLength(1);
        expect(liveRelayViews[0].imageUrl).toBe("blob:frame-2");
        expect(URL.revokeObjectURL).not.toHaveBeenCalledWith("blob:frame-2");
    });
});
