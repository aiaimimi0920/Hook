import { afterEach, describe, expect, it, vi } from "vitest";
import { graphStore } from "../../src/features/workspace/state/graphStore";
import { enhancementNotices, selectionActions, uiActions } from "../../src/features/workspace/state/uiStore";
import { liveCaptureViews } from "../../src/features/live/state/liveCaptureStore";
import { createLiveCaptureController } from "../../src/features/live/services/liveCaptureController";
import { createAppStickerEditingController } from "../../src/app/appStickerEditingController";
import { updateLiveCaptureUnitFrame } from "../../src/features/live/services/liveCaptureUnit";
import { liveUnitStatus } from "../fixtures/liveUnit";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), start: vi.fn(), stop: vi.fn(), enable: vi.fn() }));
vi.mock("../../src/features/live/services/liveGpuSnapshot", () => ({ readLiveGpuSnapshot: mocks.snapshot }));
vi.mock("../../src/features/workspace/services/syncService", () => ({ syncService: {
    updateBackendRects: vi.fn().mockResolvedValue(undefined), performWorkflowSync: vi.fn().mockResolvedValue(undefined),
} }));
vi.mock("../../src/platform/tauri/api", () => ({ isTauriRuntimeAvailable: () => true, api: {
    startLiveCapture: mocks.start, stopLiveCapture: mocks.stop,
    setLiveCaptureInteractionEnabled: mocks.enable, debugLogEvent: vi.fn().mockResolvedValue(undefined),
} }));

let live: ReturnType<typeof createLiveCaptureController> | undefined;
afterEach(() => {
    live?.dispose(); live = undefined;
    graphStore.actions.replaceUnits([]); graphStore.setRecycleBin([]);
    selectionActions.clear(); uiActions.dismissEnhancementNotice("live-runtime-test");
    vi.useRealTimers(); vi.clearAllMocks();
});

describe("Escape/delete can close failed Live units without a GPU snapshot", () => {
    it.each(["reject", "hang"])("closes and stops with a %s readback, retaining the latest cached frame", async (failure) => {
        vi.useFakeTimers();
        mocks.snapshot.mockImplementation(() => failure === "reject"
            ? Promise.reject(new Error("Live snapshot unavailable")) : new Promise(() => {}));
        mocks.start.mockResolvedValue(liveUnitStatus());
        mocks.enable.mockResolvedValue(liveUnitStatus());
        mocks.stop.mockResolvedValue(undefined);
        live = createLiveCaptureController();
        await live.start({ rect: { x: 0, y: 0, w: 200, h: 100 }, windowId: "123" });
        updateLiveCaptureUnitFrame("live-runtime-test", new Uint8Array([1]), "image/png", 1, 1);
        updateLiveCaptureUnitFrame("live-runtime-test", new Uint8Array([2]), "image/png", 2, 2);
        const editing = createAppStickerEditingController({ tauriRuntime: false,
            createImageUnit: vi.fn(), disposeSurface: vi.fn().mockResolvedValue(undefined) });
        expect(editing.deleteSelectedUnitOrAnnotation()).toBeUndefined();
        expect(graphStore.units).toHaveLength(0);
        await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledWith("live-runtime-test"));
        expect(liveCaptureViews).toHaveLength(0);
        expect(mocks.snapshot).not.toHaveBeenCalled();
        expect(graphStore.recycleBin).toHaveLength(1);
        expect(graphStore.recycleBin[0].snapshot.src).toBe("data:image/png;base64,Ag==");
        expect(enhancementNotices["live-runtime-test"] ?? []).toHaveLength(0);
    });

    it("still removes a source which failed before producing any frame", async () => {
        vi.useFakeTimers();
        mocks.start.mockResolvedValue(liveUnitStatus()); mocks.enable.mockResolvedValue(liveUnitStatus());
        mocks.stop.mockResolvedValue(undefined);
        live = createLiveCaptureController();
        await live.start({ rect: { x: 0, y: 0, w: 200, h: 100 }, windowId: "123" });
        createAppStickerEditingController({ tauriRuntime: false, createImageUnit: vi.fn(),
            disposeSurface: vi.fn().mockResolvedValue(undefined) }).deleteSelectedUnitOrAnnotation();
        expect(graphStore.units).toHaveLength(0);
        await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
        expect(mocks.snapshot).not.toHaveBeenCalled();
        expect(graphStore.recycleBin).toHaveLength(0);
    });
});
