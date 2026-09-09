import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StickerContextMenuLayer } from "../../src/components/StickerContextMenuLayer";
import { useUnitActions } from "../../src/hooks/useUnitActions";
import { createAppStickerEditingController } from "../../src/services/appStickerEditingController";
import { attachLiveCaptureUnit, detachLiveCaptureUnit, updateLiveCaptureUnitFrame } from "../../src/services/liveCaptureUnit";
import { runWithLiveCaptureSnapshots } from "../../src/services/liveCaptureSnapshotAction";
import type { LiveGpuSnapshot } from "../../src/services/liveGpuSnapshot";
import { stickerContextMenuController as menu } from "../../src/services/stickerContextMenuController";
import { graphStore } from "../../src/store/graphStore";
import { activeStickerEditTargetId, enhancementNotices, selectionActions, uiActions } from "../../src/store/uiStore";
import { liveUnitStatus } from "../fixtures/liveUnit";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), dispose: vi.fn() }));
vi.mock("../../src/services/liveGpuSnapshot", () => ({ readLiveGpuSnapshot: mocks.snapshot }));
vi.mock("../../src/services/syncService", () => ({ syncService: {
    updateBackendRects: vi.fn(async () => undefined), performWorkflowSync: vi.fn(async () => undefined),
} }));
vi.mock("../../src/hooks/useNodeParameters", () => ({ useNodeParameters: () => ({ handleParamChange: vi.fn() }) }));

const id = "action-snapshot";
const png = "data:image/png;base64,BAUG";
const frame: LiveGpuSnapshot = { bytes: new Uint8Array([4, 5, 6]), capturedAtMs: 20 };
let disposeMenu: (() => void) | undefined;
const editing = () => createAppStickerEditingController({
    tauriRuntime: false, createImageUnit: () => "", disposeSurface: mocks.dispose,
});
function pendingSnapshot() {
    let resolve!: (value: LiveGpuSnapshot) => void;
    mocks.snapshot.mockReturnValue(new Promise<LiveGpuSnapshot>((done) => { resolve = done; }));
    return () => resolve(frame);
}
function openMenu() {
    const host = document.createElement("div");
    document.body.append(host);
    disposeMenu = render(() => <StickerContextMenuLayer />, host);
    menu.openForSticker(id, { x: 10, y: 20 });
}
function clickMenu(index: number) {
    document.querySelectorAll<HTMLButtonElement>(".hook-context-menu-item")[index].click();
}
beforeEach(() => {
    uiActions.hideStickerToolbar();
    mocks.snapshot.mockReset().mockResolvedValue(frame);
    mocks.dispose.mockReset().mockResolvedValue(undefined);
    attachLiveCaptureUnit({ sessionId: id, x: 0, y: 0, width: 100, height: 50,
        renderedFrameId: 1, status: { ...liveUnitStatus(), sessionId: id } }, async () => undefined);
    updateLiveCaptureUnitFrame(id, new Uint8Array([1, 2, 3]), "image/jpeg", 1, 10);
    graphStore.setCapabilities([{ id: "test-art", label: "Test", description: "", params: [], supported_transports: [] }]);
});
afterEach(() => {
    disposeMenu?.();
    disposeMenu = undefined;
    menu.close();
    uiActions.hideStickerToolbar();
    uiActions.dismissEnhancementNotice(id);
    detachLiveCaptureUnit(id);
    graphStore.actions.replaceUnits([]);
    graphStore.setLinks([]);
    graphStore.setRecycleBin([]);
    graphStore.setReferenceLibrary([]);
    graphStore.setCapabilities([]);
    selectionActions.clear();
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe("Live snapshot action boundaries", () => {
    it("waits for fresh pixels before opening Ctrl+E editing", async () => {
        const resolve = pendingSnapshot();
        const action = editing().toggleStickerToolbarVisibility();
        expect(activeStickerEditTargetId()).toBeNull();
        resolve();
        await action;
        expect(graphStore.units[0].data.src).toBe(png);
        expect(activeStickerEditTargetId()).toBe(id);
    });
    it("does not open the old editor after selection changes", async () => {
        const resolve = pendingSnapshot();
        const action = editing().toggleStickerToolbarVisibility();
        selectionActions.clear();
        resolve();
        await action;
        expect(activeStickerEditTargetId()).toBeNull();
    });
    it("coalesces readback but only honors the newest toolbar request", async () => {
        const now = vi.spyOn(performance, "now").mockReturnValue(1_000);
        const resolve = pendingSnapshot();
        const controller = editing();
        const first = controller.toggleStickerToolbarVisibility();
        now.mockReturnValue(1_300);
        const second = controller.toggleStickerToolbarVisibility();
        resolve();
        await Promise.all([first, second]);
        expect(mocks.snapshot).toHaveBeenCalledOnce();
        expect(activeStickerEditTargetId()).toBe(id);
    });
    it("retains synchronous editing and Art creation for ordinary stickers", () => {
        detachLiveCaptureUnit(id);
        expect(editing().toggleStickerToolbarVisibility()).toBeUndefined();
        expect(activeStickerEditTargetId()).toBe(id);
        const nodeId = useUnitActions().spawnConnectedNode(id, "test-art");
        expect(typeof nodeId).toBe("string");
        expect(mocks.snapshot).not.toHaveBeenCalled();
    });
    it("creates Art only after its source owns the GPU snapshot", async () => {
        const resolve = pendingSnapshot();
        const action = useUnitActions().spawnConnectedNode(id, "test-art");
        expect(graphStore.links).toHaveLength(0);
        resolve();
        const nodeId = await action;
        expect(graphStore.units.find((unit) => unit.id === id)?.data.src).toBe(png);
        expect(graphStore.links[0]).toMatchObject({ fromUnitId: id, toUnitId: nodeId });
    });
    it("does not spawn Art after the source is removed during readback", async () => {
        const resolve = pendingSnapshot();
        const action = useUnitActions().spawnConnectedNode(id, "test-art");
        graphStore.actions.removeUnit(id);
        resolve();
        expect(await action).toBeUndefined();
        expect(graphStore.links).toHaveLength(0);
    });
    it("freezes current pixels into the recycle bin before disposing and deleting", async () => {
        const resolve = pendingSnapshot();
        const action = editing().deleteSelectedUnitOrAnnotation();
        expect(mocks.dispose).not.toHaveBeenCalled();
        expect(graphStore.units).toHaveLength(1);
        resolve();
        await action;
        expect(graphStore.recycleBin[0].snapshot.src).toBe(png);
        expect(graphStore.units).toHaveLength(0);
        expect(mocks.dispose).toHaveBeenCalledOnce();
    });
    it("cancels a delayed deletion when the selection changes", async () => {
        const resolve = pendingSnapshot();
        const action = editing().deleteSelectedUnitOrAnnotation();
        selectionActions.clear();
        resolve();
        await action;
        expect(graphStore.units).toHaveLength(1);
        expect(graphStore.recycleBin).toHaveLength(0);
    });
    it("fails closed with a notice instead of deleting stale pixels", async () => {
        mocks.snapshot.mockRejectedValue(new Error("readback failed"));
        await editing().deleteSelectedUnitOrAnnotation();
        expect(graphStore.units).toHaveLength(1);
        expect(graphStore.recycleBin).toHaveLength(0);
        expect(enhancementNotices[id]?.[0].source?.id).toBe("live-snapshot");
    });
    it("does not mislabel a downstream action exception as readback failure", async () => {
        await expect(runWithLiveCaptureSnapshots([id], () => { throw new Error("action failed"); }))
            .rejects.toThrow("action failed");
        expect(enhancementNotices[id]).toBeUndefined();
    });
    it("clears only the snapshot notice after a successful retry", async () => {
        mocks.snapshot.mockRejectedValueOnce(new Error("busy"));
        await runWithLiveCaptureSnapshots([id], () => undefined);
        uiActions.showEnhancementNotice(id, { feature: "Interaction", title: "Permission", message: "Denied",
            source: { namespace: "core", id: "permission" } });
        await runWithLiveCaptureSnapshots([id], () => undefined);
        expect(enhancementNotices[id]?.map((notice) => notice.source?.id)).toEqual(["permission"]);
    });
    it("captures current pixels for both context-menu reference and close", async () => {
        openMenu();
        clickMenu(4);
        await vi.waitFor(() => expect(graphStore.referenceLibrary[0]?.snapshot.src).toBe(png));
        menu.openForSticker(id, { x: 10, y: 20 });
        clickMenu(0);
        await vi.waitFor(() => expect(graphStore.recycleBin[0]?.snapshot.src).toBe(png));
        expect(graphStore.units).toHaveLength(0);
    });
    it("does not complete a menu action after the menu is dismissed", async () => {
        const resolve = pendingSnapshot();
        openMenu();
        clickMenu(0);
        menu.close();
        resolve();
        await vi.waitFor(() => expect(graphStore.units[0].data.src).toBe(png));
        expect(graphStore.units).toHaveLength(1);
        expect(graphStore.recycleBin).toHaveLength(0);
    });
});
