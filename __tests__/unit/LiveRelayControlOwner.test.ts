import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/services/api";
import { createLiveRelayController, type LiveRelayController } from "../../src/services/liveRelayController";
import type { LiveRelaySnapshot } from "../../src/services/liveRelay";
import { liveRelayActions, liveRelayViews } from "../../src/store/liveRelayStore";

vi.mock("../../src/services/api", () => ({ api: {
    publishLiveCaptureToLoom: vi.fn(), discoverLiveRelaySessions: vi.fn(), getLiveRelayStatus: vi.fn(),
    stopLiveRelaySession: vi.fn(), changeLiveRelayController: vi.fn(), reclaimLiveRelayControl: vi.fn(),
    configureLiveRelayTrigger: vi.fn(),
} }));
const connected: LiveRelaySnapshot = {
    relayId: "relay:source", liveSessionId: "live:source", role: "source", captureSessionId: "capture:a",
    connectionState: "connected", epoch: 1, lastFrameId: 10, receivedFrames: 10, reconnectCount: 0,
    overwrittenFrames: 0, controllerOwned: false, remoteControlActive: false, lastInputSequence: 0,
    mediaTransport: "websocket_binary", networkScope: "loopback_http", latencyState: "unavailable",
    observationCapabilities: [], observationState: "unsupported", observations: [], triggers: [], triggerAudits: [],
};
let controller: LiveRelayController;
let finish: (status: LiveRelaySnapshot) => void;
const publish = () => controller.publish("capture:a", "Source", { width: 64, height: 32 });
const operations = ["acquire", "release", "reclaim", "trigger"] as const;
const run = (action: typeof operations[number]) => {
    if (action === "trigger") return controller.configureTrigger({
        relayId: connected.relayId, bindingId: "binding:a", enabled: false,
        target: { surfaceInstanceId: "surface:a", surfaceAttachmentId: "attachment:a",
            surfaceNodeId: "node:a", surfaceEvent: "event:a", surfaceAction: "action:a" },
        condition: { conditionId: "condition:a", revision: 1, observationId: "observation:a",
            operator: "equals", operand: 1, stableForMs: 0, risingEdge: true,
            rearm: false, minimumConfidence: "exact" },
    });
    return action === "reclaim" ? controller.reclaim(connected.relayId)
        : controller.changeController(connected.relayId, action === "acquire");
};

beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks(); liveRelayActions.clear();
    vi.mocked(api.publishLiveCaptureToLoom).mockResolvedValue({ ...connected });
    vi.mocked(api.discoverLiveRelaySessions).mockResolvedValue({ protocolVersion: "loom.live.v1", sessions: [] });
    vi.mocked(api.getLiveRelayStatus).mockResolvedValue({ ...connected });
    vi.mocked(api.stopLiveRelaySession).mockResolvedValue(undefined);
    const pending = () => new Promise<LiveRelaySnapshot>((resolve) => { finish = resolve; });
    vi.mocked(api.changeLiveRelayController).mockImplementation(pending);
    vi.mocked(api.reclaimLiveRelayControl).mockImplementation(pending);
    vi.mocked(api.configureLiveRelayTrigger).mockImplementation(pending);
    controller = createLiveRelayController();
});
afterEach(() => { controller.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("does not release control after its owner stops while the input queue drains", async () => {
    await publish();
    const operation = controller.changeController(connected.relayId, false);
    const stopped = controller.stop(connected.relayId);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const calls = vi.mocked(api.changeLiveRelayController).mock.calls.length;
    if (calls) finish({ ...connected });
    await Promise.all([operation, stopped]);
    expect(calls).toBe(0);
    expect(liveRelayViews).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
});

// 注入 IPC 返回顺序，检查本地 owner 边界，不证明服务端已撤销在途请求。
describe.each(operations)("LiveRelay %s response ownership", (action) => {
    it.each(["replacement", "closed", "epoch", "session", "dispose"] as const)(
        "rejects a late response after %s", async (boundary) => {
            await publish();
            const operation = run(action);
            await vi.advanceTimersByTimeAsync(0);
            if (boundary === "replacement") {
                await controller.stop(connected.relayId); await publish();
            } else if (boundary === "dispose") {
                controller.dispose();
            } else {
                liveRelayActions.updateStatus(connected.relayId, {
                    ...connected,
                    ...(boundary === "closed" ? { connectionState: "closed" as const } : {}),
                    ...(boundary === "epoch" ? { epoch: 2 } : {}),
                    ...(boundary === "session" ? { liveSessionId: "live:new" } : {}),
                });
            }
            if (boundary !== "dispose") liveRelayActions.setError(connected.relayId, "current-owner-error");
            const before = liveRelayViews[0] ? JSON.parse(JSON.stringify(liveRelayViews[0])) : undefined;
            finish({ ...connected, controllerOwned: true, remoteControlActive: true, lastInputSequence: 999 });
            await operation;
            expect(liveRelayViews[0]).toEqual(before);
        },
    );

    it("applies the response while the same owner remains active", async () => {
        await publish();
        const operation = run(action); await vi.advanceTimersByTimeAsync(0);
        finish({ ...connected, lastInputSequence: 7 }); await operation;
        expect(liveRelayViews[0].status.lastInputSequence).toBe(7);
    });

    it("preserves an active owner's API error without rewriting status", async () => {
        vi.mocked(api.changeLiveRelayController).mockRejectedValue(new Error("denied"));
        vi.mocked(api.reclaimLiveRelayControl).mockRejectedValue(new Error("denied"));
        vi.mocked(api.configureLiveRelayTrigger).mockRejectedValue(new Error("denied"));
        await publish();
        await expect(run(action)).rejects.toThrow("denied");
        expect(liveRelayViews[0].status.lastInputSequence).toBe(0);
        expect(liveRelayViews[0].status.controllerOwned).toBe(false);
    });

    it("does not dispatch a new request for a terminal owner", async () => {
        await publish();
        liveRelayActions.updateStatus(connected.relayId, { ...connected, connectionState: "closed" });
        // 不等待潜在错误实现中的在途请求，以免用测试超时冒充精确失败。
        const operation = run(action);
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        const calls = vi.mocked(api.changeLiveRelayController).mock.calls.length
            + vi.mocked(api.reclaimLiveRelayControl).mock.calls.length
            + vi.mocked(api.configureLiveRelayTrigger).mock.calls.length;
        if (calls) finish({ ...connected });
        await operation;
        expect(calls).toBe(0);
    });
});
