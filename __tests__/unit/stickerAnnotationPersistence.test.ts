import { afterEach, expect, it, vi } from "vitest";
import { createStickerAnnotationPersistence } from "../../src/components/stickerAnnotationPersistenceController";
import { graphStore } from "../../src/store/graphStore";
import { syncService } from "../../src/services/syncService";

vi.mock("../../src/store/graphStore", () => ({ graphStore: { actions: {
    updateStickerEditData: vi.fn(), propagateStickerEditsFrom: vi.fn(),
} } }));
vi.mock("../../src/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn() } }));
vi.mock("../../src/store/uiStore", () => ({ uiActions: { pushStickerHistory: vi.fn() } }));
afterEach(() => vi.resetAllMocks());
const create = () => createStickerAnnotationPersistence({
    unitId: () => "unit", unit: () => undefined,
    annotationState: () => ({ elements: [], serialCounter: 1 }),
});

it("marks local edits, propagates them, then awaits workflow synchronization", async () => {
    const order: string[] = [];
    let finish!: () => void;
    vi.mocked(graphStore.actions.updateStickerEditData).mockImplementation(() => { order.push("edit"); });
    vi.mocked(graphStore.actions.propagateStickerEditsFrom).mockImplementation(() => { order.push("propagate"); return []; });
    vi.mocked(syncService.performWorkflowSync).mockImplementation(() => {
        order.push("sync");
        return new Promise<void>(resolve => { finish = resolve; });
    });
    const patch = { annotationState: { elements: [], serialCounter: 2 } };
    let complete = false;
    const pending = create().patchUnitData(patch).then(() => { complete = true; });
    expect(graphStore.actions.updateStickerEditData).toHaveBeenCalledExactlyOnceWith("unit", patch);
    expect(graphStore.actions.propagateStickerEditsFrom).toHaveBeenCalledExactlyOnceWith("unit");
    expect(order).toEqual(["edit", "propagate", "sync"]);
    await Promise.resolve(); expect(complete).toBe(false);
    finish(); await pending; expect(complete).toBe(true);
});

it("does not swallow synchronization failure", async () => {
    const reason = new Error("sync failed");
    vi.mocked(syncService.performWorkflowSync).mockRejectedValue(reason);
    await expect(create().patchUnitData({})).rejects.toBe(reason);
    expect(graphStore.actions.updateStickerEditData).toHaveBeenCalledOnce();
    expect(graphStore.actions.propagateStickerEditsFrom).toHaveBeenCalledOnce();
});
