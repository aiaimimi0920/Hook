import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/services/api";
import { createLiveRelayController, type LiveRelayController } from "../../src/services/liveRelayController";
import type { LiveRelaySessionSummary, LiveRelaySnapshot } from "../../src/services/liveRelay";
import { liveRelayActions, liveRelayViews } from "../../src/store/liveRelayStore";

vi.mock("../../src/services/api", () => ({ api: {
    joinLiveRelaySession: vi.fn(), pollLiveRelayFrame: vi.fn(), stopLiveRelaySession: vi.fn(),
    sendLiveRelayInput: vi.fn(), changeLiveRelayController: vi.fn(),
} }));
const connected: LiveRelaySnapshot = {
    relayId: "relay:a", liveSessionId: "live:a", role: "viewer", connectionState: "connected",
    epoch: 1, lastFrameId: 0, receivedFrames: 0, reconnectCount: 0, overwrittenFrames: 0,
    controllerOwned: true, remoteControlActive: false, lastInputSequence: 0,
    mediaTransport: "websocket_binary", networkScope: "loopback_http", latencyState: "unavailable",
    observationCapabilities: [], observationState: "unsupported", observations: [], triggers: [], triggerAudits: [],
};
const session: LiveRelaySessionSummary = {
    session: {
        sessionId: "live:a", sourceDeviceId: "source:a", sourceHookId: "hook:a", sourceKind: "window",
        sourceWindowIdentity: {}, frameStream: { width: 1, height: 1, targetFps: 30 },
        interactionCapabilities: [], observationCapabilities: [], triggerBindings: [], viewerDevices: [],
    }, epoch: 1, sourceConnected: true, closed: false,
};
let controller: LiveRelayController;
const join = () => controller.join(session, {
    unitId: "unit:a", instanceId: "instance:a", attachmentId: "attachment:a", label: "A",
});
const key = () => controller.sendInput(connected.relayId, { kind: "key_down", virtualKey: 65 });
const move = (x = 0.25) => controller.sendInput(connected.relayId, { kind: "mouse_move", normalizedX: x, normalizedY: 0.5 });
const boundaries = ["closed", "epoch", "session"] as const;
const invalidate = (boundary: typeof boundaries[number]) => {
    liveRelayActions.updateStatus(connected.relayId, {
        ...connected,
        ...(boundary === "closed" ? { connectionState: "closed" as const, controllerOwned: false } : {}),
        ...(boundary === "epoch" ? { epoch: 2 } : {}),
        ...(boundary === "session" ? { liveSessionId: "live:new" } : {}),
    });
};
beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks(); liveRelayActions.clear();
    vi.mocked(api.joinLiveRelaySession).mockResolvedValue({ ...connected });
    vi.mocked(api.pollLiveRelayFrame).mockResolvedValue({ status: { ...connected } });
    vi.mocked(api.stopLiveRelaySession).mockResolvedValue(undefined);
    vi.mocked(api.sendLiveRelayInput).mockImplementation(async (_id, input) => ({
        ...connected, lastInputSequence: input.sequence,
    }));
    controller = createLiveRelayController();
});
afterEach(() => { controller.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });

// 仅验证前端排队和返回顺序；native/daemon仍负责实际输入权限和释放按键。
describe("LiveRelay input owner", () => {
    it("does not consume a sequence for a stale move queued behind in-flight input", async () => {
        let finish!: (status: LiveRelaySnapshot) => void;
        vi.mocked(api.sendLiveRelayInput).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        await join(); const first = key(); await vi.advanceTimersByTimeAsync(0);
        await move(); await vi.advanceTimersByTimeAsync(0);
        invalidate("epoch");
        finish({ ...connected, lastInputSequence: 1 }); await first;
        await Promise.resolve(); await Promise.resolve();
        vi.mocked(api.sendLiveRelayInput).mockResolvedValue({ ...connected, epoch: 2, lastInputSequence: 2 });
        await key();
        expect(api.sendLiveRelayInput).toHaveBeenCalledTimes(2);
        expect(api.sendLiveRelayInput).toHaveBeenLastCalledWith(connected.relayId, {
            kind: "key_down", virtualKey: 65, sequence: 2,
        });
    });

    it("releases the same session after draining input advances its epoch", async () => {
        let finish!: (status: LiveRelaySnapshot) => void;
        vi.mocked(api.sendLiveRelayInput).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        vi.mocked(api.changeLiveRelayController).mockResolvedValue({ ...connected, epoch: 2, controllerOwned: false });
        await join(); const first = key(); await vi.advanceTimersByTimeAsync(0);
        const release = controller.changeController(connected.relayId, false);
        finish({ ...connected, epoch: 2, lastInputSequence: 1 });
        await Promise.all([first, release]);
        expect(api.changeLiveRelayController).toHaveBeenCalledWith(connected.relayId, "release", undefined);
        expect(liveRelayViews[0].status.controllerOwned).toBe(false);
    });

    it.each(boundaries)("rejects a pending input result after %s", async (boundary) => {
        let finish!: (status: LiveRelaySnapshot) => void;
        vi.mocked(api.sendLiveRelayInput).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        await join(); const pending = key(); await vi.advanceTimersByTimeAsync(0);
        expect(api.sendLiveRelayInput).toHaveBeenCalledTimes(1);
        invalidate(boundary); liveRelayActions.setError(connected.relayId, "current-owner-error");
        const before = JSON.parse(JSON.stringify(liveRelayViews[0]));
        finish({ ...connected, lastInputSequence: 999 }); await pending;
        expect(liveRelayViews[0]).toEqual(before);
    });

    it.each(boundaries)("does not write a late input error after %s", async (boundary) => {
        let fail!: (error: Error) => void;
        vi.mocked(api.sendLiveRelayInput).mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
        await join(); const pending = key().catch(error => error); await vi.advanceTimersByTimeAsync(0);
        invalidate(boundary); liveRelayActions.setError(connected.relayId, "current-owner-error");
        fail(new Error("old-input-error"));
        expect(await pending).toBeInstanceOf(Error);
        expect(liveRelayViews[0].controlError).toBe("current-owner-error");
    });

    it.each(boundaries)("drops a scheduled old pointer move after %s", async (boundary) => {
        await join(); await vi.advanceTimersByTimeAsync(0);
        await move(); invalidate(boundary); await vi.advanceTimersByTimeAsync(0);
        expect(api.sendLiveRelayInput).not.toHaveBeenCalled();
    });

    it("does not move a waiting key into a replacement owner's input queue", async () => {
        let finish!: (status: LiveRelaySnapshot) => void;
        vi.mocked(api.sendLiveRelayInput).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        await join(); const first = key(); await vi.advanceTimersByTimeAsync(0);
        const waiting = key();
        const stopped = controller.stop(connected.relayId);
        await vi.advanceTimersByTimeAsync(1000); await stopped; await join();
        finish({ ...connected, lastInputSequence: 99 }); await Promise.all([first, waiting]);
        expect(api.sendLiveRelayInput).toHaveBeenCalledTimes(1);
        expect(liveRelayViews[0].status.lastInputSequence).toBe(0);
    });

    it("preserves pointer coalescing, key ordering and independent input sequence", async () => {
        await join(); await move(0.25); await move(0.75); await key();
        const inputs = vi.mocked(api.sendLiveRelayInput).mock.calls.map(([, input]) => input);
        expect(inputs).toEqual([
            { kind: "mouse_move", normalizedX: 0.75, normalizedY: 0.5, sequence: 1 },
            { kind: "key_down", virtualKey: 65, sequence: 2 },
        ]);
        expect(liveRelayViews[0].status.lastInputSequence).toBe(2);
    });

    it("does not flush an old epoch's pending move ahead of a new key", async () => {
        await join(); await move(); invalidate("epoch");
        vi.mocked(api.sendLiveRelayInput).mockResolvedValue({ ...connected, epoch: 2 });
        await key();
        expect(api.sendLiveRelayInput).toHaveBeenCalledTimes(1);
        expect(api.sendLiveRelayInput).toHaveBeenLastCalledWith(connected.relayId, {
            kind: "key_down", virtualKey: 65, sequence: 1,
        });
    });

    it("keeps a fresh coalesced move when it replaces an old epoch's pending move", async () => {
        await join(); await vi.advanceTimersByTimeAsync(0);
        await move(0.25); invalidate("epoch"); await move(0.75);
        vi.mocked(api.sendLiveRelayInput).mockResolvedValue({ ...connected, epoch: 2 });
        await vi.advanceTimersByTimeAsync(0);
        expect(api.sendLiveRelayInput).toHaveBeenCalledTimes(1);
        expect(api.sendLiveRelayInput).toHaveBeenLastCalledWith(connected.relayId, {
            kind: "mouse_move", normalizedX: 0.75, normalizedY: 0.5, sequence: 1,
        });
    });

    it("retains errors for an input belonging to the current owner", async () => {
        await join(); vi.mocked(api.sendLiveRelayInput).mockRejectedValue(new Error("input-denied"));
        await expect(key()).rejects.toThrow("input-denied");
        expect(liveRelayViews[0].controlError).toBe("input-denied");
    });
});
