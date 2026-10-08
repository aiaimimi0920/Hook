import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/services/api";
import { createLiveRelayController, type LiveRelayController } from "../../src/services/liveRelayController";
import type { LiveRelaySnapshot } from "../../src/services/liveRelay";
import { liveRelayActions, liveRelayViews } from "../../src/store/liveRelayStore";

vi.mock("../../src/services/api", () => ({ api: {
    publishLiveCaptureToLoom: vi.fn(), discoverLiveRelaySessions: vi.fn(),
    getLiveRelayStatus: vi.fn(), reconnectLiveRelaySession: vi.fn(), stopLiveRelaySession: vi.fn(),
    reclaimLiveRelayControl: vi.fn(),
} }));

const connected: LiveRelaySnapshot = {
    relayId: "relay:source", liveSessionId: "live:source", role: "source", captureSessionId: "capture:a",
    connectionState: "connected", epoch: 1, lastFrameId: 10, receivedFrames: 10, reconnectCount: 0,
    overwrittenFrames: 0, controllerOwned: false, remoteControlActive: false, lastInputSequence: 0,
    mediaTransport: "websocket_binary", networkScope: "loopback_http", latencyState: "unavailable",
    observationCapabilities: [], observationState: "unsupported", observations: [], triggers: [], triggerAudits: [],
};
const recovering: LiveRelaySnapshot = { ...connected, connectionState: "recovering", errorCode: "control_poll_failed" };
let controller: LiveRelayController;
const publish = () => controller.publish("capture:a", "Source", { width: 64, height: 32 });

beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000); vi.resetAllMocks(); liveRelayActions.clear();
    vi.mocked(api.publishLiveCaptureToLoom).mockResolvedValue({ ...connected });
    vi.mocked(api.discoverLiveRelaySessions).mockResolvedValue({ protocolVersion: "loom.live.v1", sessions: [] });
    vi.mocked(api.getLiveRelayStatus).mockResolvedValue({ ...recovering });
    vi.mocked(api.reconnectLiveRelaySession).mockResolvedValue({ ...connected });
    vi.mocked(api.stopLiveRelaySession).mockResolvedValue(undefined);
    controller = createLiveRelayController();
});
afterEach(() => { controller.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("LiveRelay source recovery owner", () => {
    it.each([
        ["status", "resolve"], ["status", "reject"],
        ["reconnect", "resolve"], ["reconnect", "reject"],
    ] as const)("preserves control-confirmed closure during pending %s / %s", async (stage, outcome) => {
        let finish!: (status: LiveRelaySnapshot) => void;
        let fail!: (error: Error) => void;
        const pending = new Promise<LiveRelaySnapshot>((resolve, reject) => { finish = resolve; fail = reject; });
        if (stage === "status") vi.mocked(api.getLiveRelayStatus).mockReturnValue(pending);
        else vi.mocked(api.reconnectLiveRelaySession).mockReturnValue(pending);
        await publish(); await vi.advanceTimersByTimeAsync(0);
        vi.mocked(api.reclaimLiveRelayControl).mockResolvedValue({
            ...connected, connectionState: "closed", errorCode: "live_media_device_revoked",
        });
        await controller.reclaim(connected.relayId);
        liveRelayActions.setError(connected.relayId, "terminal-owner-error");
        if (outcome === "resolve") finish({ ...recovering, lastFrameId: 999 });
        else fail(new Error("late transport failure"));
        await vi.advanceTimersByTimeAsync(10_000);
        expect(liveRelayViews[0].status.connectionState).toBe("closed");
        expect(liveRelayViews[0].status.errorCode).toBe("live_media_device_revoked");
        expect(liveRelayViews[0].status.lastFrameId).toBe(connected.lastFrameId);
        expect(liveRelayViews[0].controlError).toBe("terminal-owner-error");
        expect(api.getLiveRelayStatus).toHaveBeenCalledTimes(1);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(stage === "status" ? 0 : 1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("gives terminal closure precedence over a stale control polling error", async () => {
        vi.mocked(api.getLiveRelayStatus).mockResolvedValue({
            ...connected, connectionState: "closed", errorCode: "control_poll_failed",
        });
        await publish(); await vi.advanceTimersByTimeAsync(10_000);
        expect(api.reconnectLiveRelaySession).not.toHaveBeenCalled();
        expect(liveRelayViews[0].status.connectionState).toBe("closed");
        expect(api.getLiveRelayStatus).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("throttles failed recovery attempts to at least five seconds", async () => {
        vi.mocked(api.reconnectLiveRelaySession).mockRejectedValue(new Error("daemon offline"));
        await publish(); await vi.advanceTimersByTimeAsync(0);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(4999);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(401);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1);
    });

    it("still recovers a nonterminal source with a control polling error", async () => {
        vi.mocked(api.getLiveRelayStatus).mockResolvedValue({ ...connected, errorCode: "control_poll_failed" });
        await publish(); await vi.advanceTimersByTimeAsync(0);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
        expect(liveRelayViews[0].status.connectionState).toBe("connected");
        expect(liveRelayViews[0].status.controllerOwned).toBe(false);
        expect(vi.getTimerCount()).toBe(1);
    });

    it("does not retry unavailable or terminal source recovery", async () => {
        vi.mocked(api.getLiveRelayStatus).mockResolvedValue({ ...recovering, errorCode: "source_recovery_unavailable" });
        await publish(); await vi.advanceTimersByTimeAsync(10_000);
        expect(api.reconnectLiveRelaySession).not.toHaveBeenCalled();
        vi.mocked(api.getLiveRelayStatus).mockResolvedValue({ ...connected, connectionState: "closed", errorCode: "live_media_device_revoked" });
        await vi.advanceTimersByTimeAsync(400);
        expect(liveRelayViews[0].status.connectionState).toBe("closed");
        expect(api.reconnectLiveRelaySession).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(["stop", "dispose"] as const)("rejects late reconnect completion after %s", async (action) => {
        let finish!: (status: LiveRelaySnapshot) => void;
        vi.mocked(api.reconnectLiveRelaySession).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        await publish(); await vi.advanceTimersByTimeAsync(0);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
        if (action === "stop") await controller.stop(connected.relayId);
        else controller.dispose();
        finish({ ...connected, lastFrameId: 99 });
        await vi.advanceTimersByTimeAsync(10_000);
        expect(liveRelayViews).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(api.stopLiveRelaySession).toHaveBeenCalledWith(connected.relayId);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
    });

    it("does not overlap pending recovery or reacquire input authority", async () => {
        let finish!: (status: LiveRelaySnapshot) => void;
        vi.mocked(api.reconnectLiveRelaySession).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        await publish(); await vi.advanceTimersByTimeAsync(15_000);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
        expect(api.getLiveRelayStatus).toHaveBeenCalledTimes(1);
        vi.mocked(api.getLiveRelayStatus).mockResolvedValue({ ...connected });
        finish({ ...connected }); await vi.advanceTimersByTimeAsync(400);
        expect(liveRelayViews[0].status.controllerOwned).toBe(false);
        expect(liveRelayViews[0].status.remoteControlActive).toBe(false);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
    });

    it("does not apply the old owner's recovery to a replacement generation", async () => {
        let finish!: (status: LiveRelaySnapshot) => void;
        vi.mocked(api.reconnectLiveRelaySession).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        await publish(); await vi.advanceTimersByTimeAsync(0);
        await controller.stop(connected.relayId);
        vi.mocked(api.getLiveRelayStatus).mockResolvedValue({ ...connected });
        await publish(); await vi.advanceTimersByTimeAsync(0);
        finish({ ...connected, lastFrameId: 999 });
        await vi.advanceTimersByTimeAsync(0);
        expect(liveRelayViews).toHaveLength(1);
        expect(liveRelayViews[0].status.lastFrameId).toBe(connected.lastFrameId);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);
    });
});
