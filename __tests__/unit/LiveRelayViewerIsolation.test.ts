import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/services/api";
import { createLiveRelayController, type LiveRelayController } from "../../src/services/liveRelayController";
import type { LiveRelayFrameDescriptor, LiveRelaySessionSummary, LiveRelaySnapshot } from "../../src/services/liveRelay";
import { liveRelayActions, liveRelayViews } from "../../src/store/liveRelayStore";

vi.mock("../../src/services/api", () => ({ api: {
    joinLiveRelaySession: vi.fn(), pollLiveRelayFrame: vi.fn(), readLiveRelayFrame: vi.fn(),
    stopLiveRelaySession: vi.fn(),
} }));

const status = (id: string): LiveRelaySnapshot => ({
    relayId: id, liveSessionId: id, role: "viewer", connectionState: "connected",
    epoch: 1, lastFrameId: 0, receivedFrames: 0, reconnectCount: 0, overwrittenFrames: 0,
    controllerOwned: false, remoteControlActive: false, lastInputSequence: 0,
    mediaTransport: "websocket_binary", networkScope: "loopback_http", latencyState: "unavailable",
    observationCapabilities: [], observationState: "unsupported", observations: [], triggers: [], triggerAudits: [],
});
const session = (id: string): LiveRelaySessionSummary => ({
    session: {
        sessionId: id, sourceDeviceId: "source:a", sourceHookId: "hook:a", sourceKind: "region",
        sourceWindowIdentity: {}, frameStream: { width: 1, height: 1, targetFps: 30 },
        interactionCapabilities: [], observationCapabilities: [], triggerBindings: [], viewerDevices: [],
    }, epoch: 1, sourceConnected: true, closed: false,
});
const frame = (id: string, frameId: number): LiveRelayFrameDescriptor => ({
    relayId: id, liveSessionId: id, epoch: 1, frameId,
    captureTimestampMs: 0, encodeTimestampMs: 0, receivedTimestampMs: 0,
    width: 1, height: 1, codec: "raw_bgra", colorSpace: "srgb", byteLength: 4, droppedFrames: 0,
});
let controller: LiveRelayController;
let createdUrls: string[];
let decode: (url: string) => Promise<void>;
const view = (id: string) => liveRelayViews.find((entry) => entry.relayId === id);
const pollCount = (id: string) => vi.mocked(api.pollLiveRelayFrame).mock.calls.filter(([relay]) => relay === id).length;
const join = async (count: number) => {
    for (let i = 0; i < count; i++) {
        await controller.join(session(`relay:${i}`), {
            unitId: `unit:${i}`, instanceId: `instance:${i}`, attachmentId: `attachment:${i}`, label: `${i}`,
        });
    }
};

beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks(); liveRelayActions.clear(); createdUrls = [];
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
        const url = `blob:frame-${createdUrls.length}`;
        createdUrls.push(url);
        return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    decode = () => Promise.resolve();
    vi.stubGlobal("Image", class {
        src = ""; naturalWidth = 1; naturalHeight = 1;
        decode() { return decode(this.src); }
    });
    vi.mocked(api.joinLiveRelaySession).mockImplementation(async ({ liveSessionId }) => status(liveSessionId));
    vi.mocked(api.pollLiveRelayFrame).mockImplementation(async (id, afterId) => ({
        status: status(id), frame: frame(id, afterId + 1),
    }));
    vi.mocked(api.readLiveRelayFrame).mockResolvedValue(new Uint8Array(4));
    vi.mocked(api.stopLiveRelaySession).mockResolvedValue(undefined);
    controller = createLiveRelayController();
});
afterEach(() => {
    controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

// 单控制器、多独立会话的 IPC/解码夹具，不是同一媒体流的多设备原生验收。
describe.each([2, 4])("LiveRelay %i-view software isolation", (count) => {
    it("keeps peers advancing while one read stalls and rejects its late result after stop", async () => {
        let finishRead!: (bytes: Uint8Array<ArrayBuffer>) => void;
        vi.mocked(api.readLiveRelayFrame).mockImplementation((id) => id === "relay:0"
            ? new Promise((resolve) => { finishRead = resolve; })
            : Promise.resolve(new Uint8Array(4)));
        await join(count); await vi.advanceTimersByTimeAsync(401);
        expect(pollCount("relay:0")).toBe(1);
        expect(view("relay:0")?.submittedFrameId).toBe(0);
        for (let i = 1; i < count; i++) expect(view(`relay:${i}`)?.submittedFrameId).toBe(6);
        await controller.stop("relay:0");
        const urlsBeforeLateRead = createdUrls.length;
        finishRead(new Uint8Array(4)); await vi.advanceTimersByTimeAsync(1);
        expect(createdUrls).toHaveLength(urlsBeforeLateRead);
        expect(view("relay:0")).toBeUndefined();
        await vi.advanceTimersByTimeAsync(80);
        for (let i = 1; i < count; i++) expect(view(`relay:${i}`)?.submittedFrameId).toBe(7);
        expect(pollCount("relay:0")).toBe(1);
        expect(vi.getTimerCount()).toBe(count - 1);
    });

    it("isolates a stalled decoder and releases all URLs and timers on disposal", async () => {
        let finishDecode!: () => void;
        decode = (url) => url === "blob:frame-0"
            ? new Promise((resolve) => { finishDecode = resolve; }) : Promise.resolve();
        await join(count); await vi.advanceTimersByTimeAsync(401);
        expect(view("relay:0")?.submittedFrameId).toBe(0);
        expect(pollCount("relay:0")).toBe(1);
        for (let i = 1; i < count; i++) expect(view(`relay:${i}`)?.submittedFrameId).toBe(6);
        await controller.stop("relay:0"); finishDecode(); await vi.advanceTimersByTimeAsync(80);
        for (let i = 1; i < count; i++) expect(view(`relay:${i}`)?.submittedFrameId).toBe(7);
        controller.dispose(); await vi.advanceTimersByTimeAsync(2000);
        expect(liveRelayViews).toHaveLength(0);
        expect(vi.getTimerCount()).toBe(0);
        const revoked = vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url);
        expect(revoked.sort()).toEqual([...createdUrls].sort());
        expect(api.stopLiveRelaySession).toHaveBeenCalledTimes(count);
    });

    it("isolates terminal closure and preserves each peer's frame identity", async () => {
        await join(count); await vi.advanceTimersByTimeAsync(1);
        const closedUrl = view("relay:0")?.imageUrl;
        vi.mocked(api.pollLiveRelayFrame).mockImplementation(async (id, afterId) => id === "relay:0"
            ? { status: { ...status(id), connectionState: "closed" } }
            : { status: status(id), frame: frame(id, afterId + 1) });
        await vi.advanceTimersByTimeAsync(400);
        expect(view("relay:0")?.imageUrl).toBeUndefined();
        expect(view("relay:0")?.presentation).toBeUndefined();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(closedUrl);
        expect(pollCount("relay:0")).toBe(2);
        for (let i = 1; i < count; i++) {
            expect(view(`relay:${i}`)?.presentation).toMatchObject({
                liveSessionId: `relay:${i}`, frameId: 6, evidence: "decoded_submitted",
            });
        }
        expect(vi.getTimerCount()).toBe(count - 1);
    });
});
