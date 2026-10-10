import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/services/api";
import { createLiveRelayController, type LiveRelayController } from "../../src/services/liveRelayController";
import type { LiveRelaySessionSummary, LiveRelaySnapshot } from "../../src/services/liveRelay";
import { liveRelayActions, liveRelayViews } from "../../src/store/liveRelayStore";

vi.mock("../../src/services/api", () => ({ api: {
    joinLiveRelaySession: vi.fn(), pollLiveRelayFrame: vi.fn(), reconnectLiveRelaySession: vi.fn(),
    stopLiveRelaySession: vi.fn(), sendLiveRelayInput: vi.fn(), changeLiveRelayController: vi.fn(),
} }));

const connected: LiveRelaySnapshot = {
    relayId: "relay:a", liveSessionId: "live:a", role: "viewer", connectionState: "connected",
    epoch: 1, lastFrameId: 10, receivedFrames: 10, reconnectCount: 0, overwrittenFrames: 0,
    controllerOwned: false, remoteControlActive: false, lastInputSequence: 0,
    mediaTransport: "websocket_binary", networkScope: "loopback_http", latencyState: "unavailable",
    observationCapabilities: [], observationState: "unsupported", observations: [], triggers: [], triggerAudits: [],
};
const expired: LiveRelaySnapshot = {
    ...connected, connectionState: "closed", errorCode: "live_viewer_authorization_required",
};
const session: LiveRelaySessionSummary = {
    session: {
        sessionId: "live:a", sourceDeviceId: "source:a", sourceHookId: "hook:a", sourceKind: "region",
        sourceWindowIdentity: {}, frameStream: { width: 1, height: 1, targetFps: 30 },
        interactionCapabilities: [], observationCapabilities: [], triggerBindings: [], viewerDevices: [],
    }, epoch: 1, sourceConnected: true, closed: false,
};
let controller: LiveRelayController;
const join = () => controller.join(session, {
    unitId: "unit:a", instanceId: "instance:a", attachmentId: "attachment:a", label: "A",
});
const pendingRenewal = () => {
    let finish!: (status: LiveRelaySnapshot) => void;
    vi.mocked(api.reconnectLiveRelaySession).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    return (status = connected) => finish({ ...status });
};

beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000); vi.resetAllMocks(); liveRelayActions.clear();
    vi.mocked(api.joinLiveRelaySession).mockResolvedValue({ ...connected });
    vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status: { ...connected } });
    vi.mocked(api.pollLiveRelayFrame).mockResolvedValueOnce({ status: { ...expired } });
    vi.mocked(api.reconnectLiveRelaySession).mockResolvedValue({ ...connected, lastInputSequence: 9 });
    vi.mocked(api.stopLiveRelaySession).mockResolvedValue(undefined);
    vi.mocked(api.sendLiveRelayInput).mockResolvedValue({ ...connected, lastInputSequence: 10 });
    controller = createLiveRelayController();
});
afterEach(() => { controller.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("LiveRelay viewer credential renewal", () => {
    it("retains the original view and restarts its input cursor without acquiring control", async () => {
        await join();
        const { x, y, width, height, pinned } = liveRelayViews[0];
        const geometry = { x, y, width, height, pinned };
        await vi.advanceTimersByTimeAsync(100);
        expect(liveRelayViews).toHaveLength(1);
        expect(liveRelayViews[0]).toMatchObject(geometry);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
        expect(api.pollLiveRelayFrame).toHaveBeenLastCalledWith(connected.relayId, 0);
        await controller.sendInput(connected.relayId, { kind: "key_down", virtualKey: 65 });
        expect(api.sendLiveRelayInput).toHaveBeenLastCalledWith(connected.relayId,
            expect.objectContaining({ sequence: 10 }));
        expect(api.changeLiveRelayController).not.toHaveBeenCalled();
    });

    it.each(["live_media_device_revoked", "live_session_closed", "control_poll_failed"])("never renews terminal %s", async code => {
        vi.mocked(api.pollLiveRelayFrame).mockReset().mockResolvedValue({ status: { ...expired, errorCode: code } });
        await join(); await vi.advanceTimersByTimeAsync(60_000);
        expect(api.reconnectLiveRelaySession).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("leaves a failed attempt closed with no retry timer", async () => {
        vi.mocked(api.reconnectLiveRelaySession).mockRejectedValue(new Error("unavailable"));
        await join(); await vi.advanceTimersByTimeAsync(60_000);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
        expect(api.pollLiveRelayFrame).toHaveBeenCalledTimes(1);
        expect(liveRelayViews[0].status.connectionState).toBe("closed");
        expect(liveRelayViews[0].controlError).toContain("重新加入");
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(["stop", "dispose", "revoked"] as const)("rejects late success after %s", async action => {
        const finish = pendingRenewal();
        await join(); await vi.advanceTimersByTimeAsync(0);
        if (action === "stop") await controller.stop(connected.relayId);
        else if (action === "dispose") controller.dispose();
        else liveRelayActions.updateStatus(connected.relayId, { ...expired, errorCode: "live_media_device_revoked" });
        finish(); await vi.advanceTimersByTimeAsync(60_000);
        if (action === "revoked") expect(liveRelayViews[0].status.errorCode).toBe("live_media_device_revoked");
        else expect(liveRelayViews).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("blocks new input while pending and rejects old input completion", async () => {
        let completeInput!: (value: LiveRelaySnapshot) => void;
        vi.mocked(api.sendLiveRelayInput).mockReturnValue(new Promise(resolve => { completeInput = resolve; }));
        const finish = pendingRenewal();
        await join();
        const input = controller.sendInput(connected.relayId, { kind: "key_down", virtualKey: 65 });
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await controller.sendInput(connected.relayId, { kind: "key_down", virtualKey: 65 });
        expect(api.sendLiveRelayInput).toHaveBeenCalledTimes(1);
        completeInput({ ...connected, controllerOwned: true, lastFrameId: 999 }); await input;
        expect(liveRelayViews[0].status.connectionState).toBe("closed");
        finish(); await vi.advanceTimersByTimeAsync(1);
        expect(liveRelayViews[0].status.controllerOwned).toBe(false);
    });

    it("does not loop if freshly minted credentials are immediately rejected", async () => {
        vi.mocked(api.pollLiveRelayFrame).mockReset().mockResolvedValue({ status: { ...expired } });
        await join(); await vi.advanceTimersByTimeAsync(60_000);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
        expect(liveRelayViews[0].status.connectionState).toBe("closed");
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each(["resolve", "reject"] as const)("renews when another IPC closes a pending poll before %s", async outcome => {
        let finish!: () => void;
        vi.mocked(api.pollLiveRelayFrame).mockReset().mockReturnValueOnce(new Promise((resolve, reject) => {
            finish = () => outcome === "resolve" ? resolve({ status: connected }) : reject(new Error("late"));
        })).mockResolvedValue({ status: connected });
        await join(); await vi.advanceTimersByTimeAsync(0);
        liveRelayActions.updateStatus(connected.relayId, expired);
        finish(); await vi.advanceTimersByTimeAsync(1);
        expect(api.reconnectLiveRelaySession).toHaveBeenCalledTimes(1);
        expect(liveRelayViews[0].status.connectionState).toBe("connected");
        expect(vi.getTimerCount()).toBe(1);
    });

    it("ignores late renewal after a same-id replacement owner", async () => {
        const finish = pendingRenewal();
        await join(); await vi.advanceTimersByTimeAsync(0);
        await controller.stop(connected.relayId);
        await join(); await vi.advanceTimersByTimeAsync(0);
        finish({ ...connected, lastFrameId: 999 });
        await vi.advanceTimersByTimeAsync(1);
        expect(liveRelayViews).toHaveLength(1);
        expect(liveRelayViews[0].status.lastFrameId).toBe(connected.lastFrameId);
        expect(vi.getTimerCount()).toBe(1);
    });
});
