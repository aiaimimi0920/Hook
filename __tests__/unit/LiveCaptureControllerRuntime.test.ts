import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveCaptureController } from "../../src/services/liveCaptureController";
import { graphStore } from "../../src/store/graphStore";
import { liveCaptureViews } from "../../src/store/liveCaptureStore";
import { liveUnitStatus } from "../fixtures/liveUnit";
import { enhancementNotices, uiActions } from "../../src/store/uiStore";
import { updateLiveCaptureUnitFrame } from "../../src/services/liveCaptureUnit";
import type { LiveGpuSnapshot } from "../../src/services/liveGpuSnapshot";
import { setLiveGpuPresenting } from "../../src/services/liveCapturePollCadence";

const mocks = vi.hoisted(() => ({ input: vi.fn(), stop: vi.fn(), start: vi.fn(), enable: vi.fn(), log: vi.fn(), poll: vi.fn(), snapshot: vi.fn() }));
vi.mock("../../src/services/liveGpuSnapshot", () => ({ readLiveGpuSnapshot: mocks.snapshot }));
vi.mock("../../src/services/api", () => ({ isTauriRuntimeAvailable: () => true, api: {
    startLiveCapture: mocks.start,
    setLiveCaptureInteractionEnabled: mocks.enable,
    debugLogEvent: mocks.log,
    sendLiveCaptureInput: mocks.input,
    stopLiveCapture: mocks.stop,
    pollLiveCaptureFrame: mocks.poll,
} }));

const controllers: ReturnType<typeof createLiveCaptureController>[] = [];
beforeEach(() => {
    vi.useFakeTimers();
    mocks.input.mockReset().mockResolvedValue(undefined);
    mocks.stop.mockResolvedValue(undefined);
    mocks.start.mockReset().mockResolvedValue(liveUnitStatus());
    mocks.enable.mockReset().mockResolvedValue(liveUnitStatus());
    mocks.log.mockResolvedValue(undefined);
    mocks.poll.mockReset();
    mocks.snapshot.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
    controllers.splice(0).forEach((controller) => controller.dispose());
    graphStore.actions.replaceUnits([]);
    uiActions.dismissEnhancementNotice("live-runtime-test");
    vi.useRealTimers();
    vi.clearAllMocks();
});
const start = async () => {
    const controller = createLiveCaptureController();
    controllers.push(controller);
    await controller.start({ rect: { x: 20, y: 30, w: 200, h: 100 }, windowId: "0x123" });
    return controller;
};

describe("Live controller Unit ownership", () => {
    it("does not overlap an in-flight poll when the GPU mirror is disabled", async () => {
        let release!: (value: { status: ReturnType<typeof liveUnitStatus>; frame: null }) => void;
        mocks.poll.mockResolvedValue({ status: liveUnitStatus(), frame: null });
        mocks.poll.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        await start();
        setLiveGpuPresenting("live-runtime-test", true);
        await vi.advanceTimersByTimeAsync(1);
        setLiveGpuPresenting("live-runtime-test", false);
        await vi.advanceTimersByTimeAsync(100);
        expect(mocks.poll).toHaveBeenCalledOnce();
        release({ status: liveUnitStatus(), frame: null });
        await vi.advanceTimersByTimeAsync(20);
        expect(mocks.poll.mock.calls.length).toBeGreaterThan(1);
    });

    it("polls six native mirrors at status cadence and immediately resumes one fallback", async () => {
        const statuses = Array.from({ length: 6 }, (_, index) => ({ ...liveUnitStatus(), sessionId: `gpu-${index}` }));
        statuses.forEach((status) => mocks.start.mockResolvedValueOnce(status));
        mocks.enable.mockImplementation(async (id: string) => statuses.find((status) => status.sessionId === id));
        mocks.poll.mockImplementation(async (id: string) => ({ status: statuses.find((status) => status.sessionId === id), frame: null }));
        const controller = createLiveCaptureController(); controllers.push(controller);
        for (const status of statuses) {
            await controller.start({ windowId: "123", rect: { x: 20, y: 30, w: 100, h: 50 } });
            setLiveGpuPresenting(status.sessionId, true);
        }
        // The real preview scheduler renews acknowledged presentation every 80 ms.
        const renewal = setInterval(() => statuses.forEach((status) => setLiveGpuPresenting(status.sessionId, true)), 80);
        try {
            await vi.advanceTimersByTimeAsync(1000);
            expect(mocks.poll.mock.calls.length).toBeGreaterThanOrEqual(24);
            expect(mocks.poll.mock.calls.length).toBeLessThanOrEqual(30);
            mocks.poll.mockClear();
            setLiveGpuPresenting("gpu-0", false);
            await vi.advanceTimersByTimeAsync(1);
            expect(mocks.poll).toHaveBeenCalledWith("gpu-0", 0);
        } finally { clearInterval(renewal); }
    });

    it("shows a terminal capture failure and stops polling", async () => {
        mocks.poll.mockResolvedValue({ status: { ...liveUnitStatus(), captureState: "failed",
            errorCode: "source_closed", errorMessage: "private page title" }, frame: null });
        await start();
        await vi.advanceTimersByTimeAsync(1);
        expect(enhancementNotices["live-runtime-test"]?.[0]).toMatchObject({
            title: "实时截图已停止更新", source: { id: "live-capture:source_closed" },
        });
        expect(JSON.stringify(enhancementNotices["live-runtime-test"])).not.toContain("private page title");
        await vi.advanceTimersByTimeAsync(2000);
        expect(mocks.poll).toHaveBeenCalledOnce();
    });

    it("shows repeated poll failure once per episode even after notice dismissal", async () => {
        mocks.poll.mockRejectedValue(new Error("private native failure"));
        await start();
        await vi.advanceTimersByTimeAsync(1);
        expect(enhancementNotices["live-runtime-test"]?.[0].source?.id).toBe("live-capture:ipc_poll_failed");
        uiActions.dismissEnhancementNotice("live-runtime-test");
        await vi.advanceTimersByTimeAsync(1500);
        expect(enhancementNotices["live-runtime-test"] ?? []).toHaveLength(0);
        mocks.poll.mockResolvedValueOnce({ status: liveUnitStatus(), frame: null });
        await vi.advanceTimersByTimeAsync(500);
        await vi.advanceTimersByTimeAsync(500);
        expect(enhancementNotices["live-runtime-test"]?.[0].source?.id).toBe("live-capture:ipc_poll_failed");
    });

    it("keeps repeated same-window captures and other windows independent when one Unit closes", async () => {
        const statuses = ["first", "second", "third"].map((sessionId, index) => ({
            ...liveUnitStatus(), sessionId, sourceWindowId: index < 2 ? "123" : "456",
        }));
        statuses.forEach((status) => mocks.start.mockResolvedValueOnce(status));
        mocks.enable.mockImplementation(async (id: string) => statuses.find((status) => status.sessionId === id));
        mocks.poll.mockImplementation(async (id: string) => ({
            status: statuses.find((status) => status.sessionId === id), frame: null,
        }));
        const controller = createLiveCaptureController();
        controllers.push(controller);
        for (const [index, status] of statuses.entries()) {
            await controller.start({ windowId: status.sourceWindowId,
                rect: { x: 20 + index * 200, y: 30, w: 100, h: 50 },
                windowRegion: { x: index * 20, y: 10, w: 100, h: 50 },
            });
        }
        expect(liveCaptureViews.map((view) => view.sessionId)).toEqual(["first", "second", "third"]);
        expect(graphStore.units.map((unit) => [unit.id, unit.x, unit.w])).toEqual([
            ["first", 20, 100], ["second", 220, 100], ["third", 420, 100],
        ]);
        expect(mocks.start.mock.calls.map(([request]) => request.windowRegion.x)).toEqual([0, 20, 40]);
        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.poll.mock.calls.map(([id]) => id)).toEqual(["first", "second", "third"]);
        await controller.sendInput("first", { kind: "key_down", virtualKey: 65 });
        await controller.sendInput("second", { kind: "key_down", virtualKey: 66 });
        expect(mocks.input.mock.calls.map(([id, input]) => [id, input.sequence])).toEqual([
            ["first", 1], ["second", 1],
        ]);
        graphStore.actions.removeUnit("second");
        await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledWith("second"));
        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(liveCaptureViews.map((view) => view.sessionId)).toEqual(["first", "third"]);
        mocks.poll.mockClear();
        await vi.advanceTimersByTimeAsync(100);
        expect(new Set(mocks.poll.mock.calls.map(([id]) => id))).toEqual(new Set(["first", "third"]));
        await controller.sendInput("first", { kind: "key_up", virtualKey: 65 });
        expect(mocks.input).toHaveBeenLastCalledWith("first", { kind: "key_up", virtualKey: 65, sequence: 2 });
    });

    it("reports a source permission refusal on the owning Unit instead of silently displaying a noninteractive frame", async () => {
        mocks.start.mockResolvedValue({ ...liveUnitStatus(), inputCapability: "permission_denied", interactionEnabled: false });
        await start();
        expect(mocks.enable).not.toHaveBeenCalled();
        expect(enhancementNotices["live-runtime-test"]?.[0]).toMatchObject({
            feature: "Interaction", source: { id: "live-control:permission_denied" },
        });
        expect(mocks.log).toHaveBeenCalledWith("live-capture-control-unavailable",
            "session=live-runtime-test code=permission_denied");
    });

    it("reports input enable failure and does not disclose arbitrary error text in diagnostics", async () => {
        mocks.enable.mockRejectedValue(new Error("provider_unavailable: private source details"));
        await start();
        const notice = enhancementNotices["live-runtime-test"]?.[0];
        expect(notice?.source?.id).toBe("live-control:live_control_failed");
        expect(JSON.stringify(notice)).not.toContain("private source details");
        expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("private source details");
    });

    it("creates a real sticker and stops its source when the graph removes it", async () => {
        await start();
        expect(graphStore.units[0]).toMatchObject({ id: "live-runtime-test", type: "sticker", x: 20, y: 30, w: 200, h: 100 });
        graphStore.actions.replaceUnits([]);
        await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledWith("live-runtime-test"));
        expect(liveCaptureViews).toHaveLength(0);
    });

    it("reserves input edges synchronously so later moves cannot overtake mouse down", async () => {
        const controller = await start();
        let unblock!: () => void;
        mocks.input.mockImplementationOnce(() => new Promise<void>((resolve) => { unblock = resolve; }));
        const id = "live-runtime-test";
        void controller.sendInput(id, { kind: "mouse_move", normalizedX: 0.1, normalizedY: 0.1 });
        const down = controller.sendInput(id, { kind: "mouse_button_down", button: "left", normalizedX: 0.2, normalizedY: 0.2 });
        void controller.sendInput(id, { kind: "mouse_move", normalizedX: 0.7, normalizedY: 0.7 });
        const up = controller.sendInput(id, { kind: "mouse_button_up", button: "left", normalizedX: 0.8, normalizedY: 0.8 });
        await Promise.resolve();
        unblock();
        await Promise.all([down, up]);
        expect(mocks.input.mock.calls.map(([, input]) => [input.kind, input.sequence])).toEqual([
            ["mouse_move", 1], ["mouse_button_down", 2], ["mouse_move", 3], ["mouse_button_up", 4],
        ]);
    });

    it("coalesces stop and retains a fresh GPU snapshot before releasing the source", async () => {
        const controller = await start();
        const id = "live-runtime-test";
        updateLiveCaptureUnitFrame(id, new Uint8Array([1]), "image/jpeg", 1, 10);
        let resolve!: (value: LiveGpuSnapshot) => void;
        mocks.snapshot.mockReturnValue(new Promise<LiveGpuSnapshot>((done) => { resolve = done; }));
        const stopping = controller.stop(id);
        expect(controller.stop(id)).toBe(stopping);
        await Promise.resolve();
        expect(mocks.snapshot).toHaveBeenCalledOnce();
        expect(mocks.stop).not.toHaveBeenCalled();
        expect(liveCaptureViews).toHaveLength(1);
        await controller.sendInput(id, { kind: "key_down", virtualKey: 65 });
        expect(mocks.input).not.toHaveBeenCalled();
        resolve({ bytes: new Uint8Array([4, 5, 6]), capturedAtMs: 20 });
        await stopping;
        expect(graphStore.units[0].data.src).toBe("data:image/png;base64,BAUG");
        expect(liveCaptureViews).toHaveLength(0);
        expect(mocks.stop).toHaveBeenCalledOnce();
    });

    it("still releases the native session if the final readback fails", async () => {
        const controller = await start();
        const id = "live-runtime-test";
        updateLiveCaptureUnitFrame(id, new Uint8Array([1]), "image/jpeg", 1, 10);
        mocks.snapshot.mockRejectedValue(new Error("snapshot unavailable"));
        await expect(controller.stop(id)).rejects.toThrow("snapshot unavailable");
        expect(mocks.stop).toHaveBeenCalledOnce();
        expect(liveCaptureViews).toHaveLength(0);
        expect(graphStore.units[0].data.src).toBe("data:image/jpeg;base64,AQ==");
    });

    it("invalidates pending stop readback on disposal without double-stopping native", async () => {
        const controller = await start();
        const id = "live-runtime-test";
        updateLiveCaptureUnitFrame(id, new Uint8Array([1]), "image/jpeg", 1, 10);
        let resolve!: (value: LiveGpuSnapshot) => void;
        mocks.snapshot.mockReturnValue(new Promise<LiveGpuSnapshot>((done) => { resolve = done; }));
        const stopping = controller.stop(id);
        const result = expect(stopping).rejects.toThrow(/ended/);
        await Promise.resolve();
        controller.dispose();
        resolve({ bytes: new Uint8Array([4]), capturedAtMs: 20 });
        await result;
        expect(mocks.stop).toHaveBeenCalledOnce();
        expect(graphStore.units[0].data.src).toBe("data:image/jpeg;base64,AQ==");
    });
});
