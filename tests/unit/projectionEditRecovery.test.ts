import { expect, it, vi } from "vitest";
import { deferred, editShape, editingHarness } from "../fixtures/projectionEdit";

it("keeps a local edit made while changing source mode", async () => {
    const h = editingHarness(); await h.sync();
    h.change(editShape("shape-a", 40));
    await h.engine.setMode(h.unit.id, "one_way"); await h.sync();
    expect(h.local()).toContainEqual(editShape("shape-a", 40));
    await h.sync();
    expect(h.remote.objects["shape-a"].value).toEqual(editShape("shape-a", 40));
});

it("restores durable pending intent when the workspace save lagged behind the request", async () => {
    const h = editingHarness(); await h.sync();
    h.change(editShape("shape-a", 40));
    vi.mocked(h.deps.edit).mockImplementationOnce(async (_link, request) => {
        h.accept(request); throw new Error("projection_network_error");
    });
    await expect(h.sync()).rejects.toThrow("projection_network_error");
    const request = structuredClone(h.stored.pending!.request);
    h.change(editShape()); h.restart();
    await h.sync(); await h.sync();
    expect(h.local()).toContainEqual(editShape("shape-a", 40));
    expect(h.remote.objects["shape-a"].value).toEqual(editShape("shape-a", 40));
    expect(vi.mocked(h.deps.edit).mock.calls.filter(([, item]) => item.operation === "apply").map(([, item]) => item)).toEqual([request, request]);
});

it("preserves edits during the durable merge commit and reports same-object conflicts", async () => {
    const h = editingHarness(); await h.sync();
    h.remote.revision = 3;
    h.remote.objects["shape-a"] = { revision: 3, value: editShape("shape-a", 60) };
    const commit = vi.mocked(h.deps.save).getMockImplementation()!;
    vi.mocked(h.deps.save).mockImplementationOnce(async (record) => {
        const saved = await commit(record);
        h.change(editShape("shape-a", 80)); h.change(editShape("local-new", 50));
        return saved;
    });
    await h.sync();
    expect(h.local()).toContainEqual(editShape("shape-a", 80));
    expect(h.local()).toContainEqual(editShape("local-new", 50));
    expect(h.stored.conflict?.code).toBe("projection_edit_object_conflict");
    expect(h.remote.objects["shape-a"].value).toEqual(editShape("shape-a", 60));
});

it("does not execute a queued mode action after the workspace has changed", async () => {
    const h = editingHarness(); await h.sync();
    h.change(editShape("shape-a", 40));
    const gate = deferred();
    vi.mocked(h.deps.edit).mockImplementationOnce(async (_link, request) => { await gate.promise; return h.accept(request); });
    const sync = h.sync();
    await vi.waitFor(() => expect(h.stored.pending).toBeDefined());
    const mode = h.engine.setMode(h.unit.id, "one_way");
    h.replaceWorkspace(); gate.resolve();
    await expect(sync).rejects.toThrow("projection_source_unavailable");
    await expect(mode).rejects.toThrow("projection_source_unavailable");
    expect(h.stored.desiredMode).toBeUndefined();
});

it("retries a temporary journal read failure and does not checkpoint live objects every poll", async () => {
    const h = editingHarness();
    vi.mocked(h.deps.load).mockRejectedValueOnce(new Error("projection_edit_storage_unavailable"));
    await expect(h.sync()).rejects.toThrow("projection_edit_storage_unavailable");
    await h.sync();
    for (let index = 0; index < 240; index += 1) h.remote.objects[`live-${index}`] = { revision: 1, value: editShape(`live-${index}`) };
    h.remote.revision += 1;
    await h.sync(); await h.sync();
    expect(vi.mocked(h.deps.edit).mock.calls.filter(([, request]) => request.operation === "checkpoint")).toHaveLength(0);
});
