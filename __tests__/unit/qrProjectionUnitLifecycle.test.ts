import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { graphStore } from "../../src/store/graphStore";
import { createProjectionSync, type ProjectionSyncDependencies } from "../../src/services/qrProjectionSync";
import { onProjectionUnitRemoved, projectionWorkspaceGeneration } from "../../src/services/qrProjectionLifecycle";
import { projectionResponse, projectionUnit } from "../fixtures/qrProjection";

vi.mock("../../src/services/qrProjectionCleanup", () => ({ queueProjectionUnlink: vi.fn() }));
const disposals: (() => void)[] = [];
function setup(role: "source" | "receiver" = "source", pending = false) {
    const unit = projectionUnit(role);
    graphStore.actions.addUnit(unit);
    let finish!: (value: ReturnType<typeof projectionResponse>) => void;
    const request = vi.fn<ProjectionSyncDependencies["request"]>().mockResolvedValue(projectionResponse());
    if (pending) request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const render = vi.fn<ProjectionSyncDependencies["render"]>().mockResolvedValue({
        snapshot: { imageBase64: btoa("a"), width: 1, height: 1 }, digest: "a".repeat(64),
    });
    const patch = vi.fn<ProjectionSyncDependencies["patch"]>();
    const status = vi.fn<ProjectionSyncDependencies["status"]>();
    const sync = createProjectionSync({
        units: () => graphStore.units, generation: projectionWorkspaceGeneration,
        onUnitRemoved: onProjectionUnitRemoved, signature: (value) => value.data.src!,
        render, request, patch, status, unlink: vi.fn().mockResolvedValue(undefined),
    });
    disposals.push(sync.dispose);
    return { unit, request, render, patch, status, sync, finish: () => finish(projectionResponse(2, "b")) };
}

describe("projection unit lifetime isolation", () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); graphStore.actions.replaceUnits([]); });
    afterEach(() => {
        disposals.splice(0).forEach((dispose) => dispose());
        graphStore.actions.replaceUnits([]); vi.useRealTimers(); vi.clearAllMocks();
    });

    it("keeps unrelated in-flight work and its rendered-content cache after deletion", async () => {
        const unrelated = projectionUnit(); unrelated.id = "unrelated"; unrelated.data.qrProjection = undefined;
        graphStore.actions.addUnit(unrelated);
        const h = setup();
        await vi.advanceTimersByTimeAsync(0);
        expect(h.render).toHaveBeenCalledTimes(1);
        let finish!: (value: ReturnType<typeof projectionResponse>) => void;
        h.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        await vi.advanceTimersByTimeAsync(1000);
        const reads = h.request.mock.calls.length;
        h.status.mockClear();
        graphStore.actions.removeUnit(unrelated.id);
        finish(projectionResponse());
        await vi.advanceTimersByTimeAsync(0);
        expect(h.status).toHaveBeenCalledWith("source", expect.objectContaining({ phase: "connected" }));
        h.sync.tick();
        expect(h.request).toHaveBeenCalledTimes(reads);
        await vi.advanceTimersByTimeAsync(1000);
        expect(h.render).toHaveBeenCalledTimes(1);
    });

    it.each(["remove", "replace"] as const)("rejects old pixels after %s and reuse of the same unit ID", async (action) => {
        const h = setup("receiver", true);
        if (action === "remove") {
            graphStore.actions.removeUnit(h.unit.id);
            graphStore.actions.addUnit(projectionUnit("receiver"));
        } else {
            graphStore.actions.replaceUnits([projectionUnit("receiver")]);
        }
        h.finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(h.patch).not.toHaveBeenCalled();
        expect(graphStore.units[0].data.src).toBe("a");
    });

    it("unsubscribes from unit removals on disposal", async () => {
        const h = setup();
        await vi.advanceTimersByTimeAsync(0);
        h.sync.dispose(); h.status.mockClear();
        graphStore.actions.removeUnit(h.unit.id);
        expect(h.status).not.toHaveBeenCalled();
    });
});
