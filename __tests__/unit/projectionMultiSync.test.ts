import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectionSync, type ProjectionSyncDependencies } from "../../src/services/qrProjectionSync";
import { projectionBindingKey, projectionBindingStatusKey, type ProjectionSenderBinding } from "../../src/services/projectionSenderBindings";
import { onProjectionUnitRemoved } from "../../src/services/qrProjectionLifecycle";
import { projectionResponse, projectionUnit } from "../fixtures/qrProjection";

const disposals: (() => void)[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => { disposals.splice(0).forEach((dispose) => dispose()); vi.useRealTimers(); });
function setup() {
    const unit = projectionUnit();
    const original = unit.data.qrProjection!;
    unit.data.qrProjection = undefined;
    const remotes = [1, 2, 3].map((id) => {
        const response = projectionResponse(); response.envelope.projectionId = `projection:${String(id).repeat(32)}`;
        return response;
    });
    unit.data.projectionSenders = remotes.map((response, index): ProjectionSenderBinding => ({
        target: { deviceId: `pc${index}`, name: `PC${index}` }, link: { ...original, envelope: response.envelope },
    }));
    let generation = 0;
    const request = vi.fn<ProjectionSyncDependencies["request"]>(async (operation) => {
        if (operation.kind !== "read" && operation.kind !== "update") throw new Error("Unexpected operation");
        const remote = remotes.find((entry) => entry.envelope.projectionId === operation.projectionId)!;
        if (operation.kind === "update") {
            expect(operation.priorRevision).toBe(remote.revision);
            remote.revision = operation.revision; remote.digest = atob(operation.snapshot.imageBase64).repeat(64);
            remote.snapshot = operation.snapshot;
        }
        return structuredClone(remote);
    });
    const render = vi.fn<ProjectionSyncDependencies["render"]>(async () => ({
        snapshot: { imageBase64: btoa(unit.data.src!), width: 1, height: 1 }, digest: unit.data.src!.repeat(64),
    }));
    const patch = vi.fn<ProjectionSyncDependencies["patch"]>((id, link, pixels, key) => {
        expect(id).toBe(unit.id); expect(key).toBeDefined(); expect(pixels).toBeUndefined();
        unit.data.projectionSenders = unit.data.projectionSenders!.flatMap((entry) =>
            projectionBindingKey(entry.link) === key ? link ? [{ ...entry, link }] : [] : [entry]);
    });
    const deps: ProjectionSyncDependencies = { units: () => [unit], generation: () => generation,
        onUnitRemoved: onProjectionUnitRemoved, signature: (item) => item.data.src!, render, request,
        unlink: vi.fn().mockResolvedValue(undefined), patch, status: vi.fn() };
    const sync = createProjectionSync(deps); disposals.push(sync.dispose);
    return { unit, remotes, request, render, patch, deps, sync, replace: () => { generation += 1; } };
}

it("shares a rasterized frame across three associations and isolates revision/status state", async () => {
    const h = setup(); await vi.advanceTimersByTimeAsync(1500);
    expect(h.render).toHaveBeenCalledTimes(1);
    for (const pixel of ["b", "c"]) {
        h.unit.data.src = pixel; await vi.advanceTimersByTimeAsync(2500);
        expect(h.remotes.map((remote) => remote.digest)).toEqual(Array(3).fill(pixel.repeat(64)));
    }
    expect(h.render).toHaveBeenCalledTimes(3);
    expect(h.unit.data.projectionSenders!.map((binding) => binding.link.revision)).toEqual([3, 3, 3]);
    for (const binding of h.unit.data.projectionSenders!) {
        expect(h.deps.status).toHaveBeenCalledWith(projectionBindingStatusKey("source", projectionBindingKey(binding.link)), expect.objectContaining({ phase: "connected" }));
    }
});

it("stops one target offline while others keep updating and restores without replaying successful updates", async () => {
    const h = setup(); await vi.advanceTimersByTimeAsync(1500);
    h.unit.data.projectionSenders![0].link.stopPending = true;
    vi.mocked(h.deps.unlink).mockRejectedValueOnce(new Error("projection_network_error"));
    h.unit.data.src = "b"; h.sync.retry("source"); await vi.advanceTimersByTimeAsync(2500);
    expect(h.unit.data.projectionSenders).toHaveLength(2);
    expect(h.remotes.map((remote) => remote.revision)).toEqual([1, 2, 2]);
    const uploads = h.request.mock.calls.filter(([operation]) => operation.kind === "update").length;
    h.sync.dispose(); const restored = createProjectionSync(h.deps); disposals.push(restored.dispose);
    await vi.advanceTimersByTimeAsync(2500);
    expect(h.request.mock.calls.filter(([operation]) => operation.kind === "update")).toHaveLength(uploads);
});

it("discards every outstanding target response when replacing the workspace", async () => {
    const h = setup(); await vi.advanceTimersByTimeAsync(1500); h.patch.mockClear();
    const finish: (() => void)[] = [];
    h.request.mockImplementation((operation) => new Promise((resolve) => {
        const remote = h.remotes.find((entry) => "projectionId" in operation && entry.envelope.projectionId === operation.projectionId)!;
        finish.push(() => resolve({ ...remote, revision: 9, digest: "b".repeat(64) }));
    }));
    await vi.advanceTimersByTimeAsync(1000); expect(finish).toHaveLength(2);
    h.replace(); for (const complete of finish) complete(); await vi.advanceTimersByTimeAsync(0);
    expect(h.patch).not.toHaveBeenCalled();
});
