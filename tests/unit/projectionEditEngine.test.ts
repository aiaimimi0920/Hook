import { expect, it, vi } from "vitest";
import { deferred, editShape, editingHarness } from "../fixtures/projectionEdit";

it("persists every request before sending and chunks independent objects without changing their base", async () => {
    const h = editingHarness(); await h.sync();
    for (let index = 0; index < 70; index += 1) h.change(editShape(`new-${index}`));
    vi.mocked(h.deps.edit).mockImplementation(async (_link, request) => {
        expect(h.stored.pending?.request).toEqual(request);
        return h.accept(request);
    });
    await h.sync();
    const requests = vi.mocked(h.deps.edit).mock.calls.map(([, request]) => request).filter((request) => request.operation === "apply");
    expect(requests.map((request) => request.changes.length)).toEqual([32, 32, 6]);
    expect(new Set(requests.map((request) => request.baseRevision))).toEqual(new Set([2]));
    expect(new Set(requests.map((request) => request.opId)).size).toBe(3);
    expect(h.stored.pending).toBeUndefined(); expect(Object.keys(h.remote.objects)).toHaveLength(71);
});

it("merges independent remote changes and exposes same-object conflicts without losing local edits", async () => {
    const h = editingHarness("receiver"); await h.sync();
    h.change(editShape("local", 45));
    h.remote.revision = 3; h.remote.objects.remote = { revision: 3, value: editShape("remote", 75) };
    await h.sync();
    expect(h.local()).toContainEqual(editShape("remote", 75)); expect(h.local()).toContainEqual(editShape("local", 45));
    h.change(editShape("shape-a", 30));
    h.remote.revision += 1; h.remote.objects["shape-a"] = { revision: h.remote.revision, value: editShape("shape-a", 90) };
    await h.sync(); await h.sync();
    expect(h.stored.conflict?.code).toBe("projection_edit_object_conflict");
    expect(h.local()).toContainEqual(editShape("shape-a", 30));
    await h.engine.resolve(h.unit.id, true);
    expect(h.remote.objects["shape-a"].value).toEqual(editShape("shape-a", 30));
    expect(h.stored.conflict).toBeUndefined();
});

it("does not send after a journal failure and retains edits made during a lost acknowledgment", async () => {
    const h = editingHarness(); await h.sync();
    h.change(editShape("shape-a", 40));
    vi.mocked(h.deps.save).mockRejectedValueOnce(new Error("projection_edit_storage_unavailable"));
    await expect(h.sync()).rejects.toThrow("projection_edit_storage_unavailable"); expect(h.deps.edit).not.toHaveBeenCalled();
    // Re-read the durable record; recovery requires an explicit choice before sending.
    await h.sync(); await h.engine.resolve(h.unit.id, true);
    h.change(editShape("shape-a", 50));
    const gate = deferred();
    vi.mocked(h.deps.edit).mockImplementationOnce(async (_link, request) => { const value = h.accept(request); await gate.promise; return value; });
    const syncing = h.sync(); await vi.waitFor(() => expect(h.stored.pending).toBeDefined());
    h.change(editShape("shape-a", 60)); gate.resolve(); await syncing;
    expect(h.local()).toContainEqual(editShape("shape-a", 60));
    await h.sync(); expect(h.remote.objects["shape-a"].value).toEqual(editShape("shape-a", 60));
});

it("preserves ambiguous restart changes as a recovery conflict while reconciling the original request", async () => {
    const h = editingHarness(); await h.sync(); h.change(editShape("shape-a", 40));
    vi.mocked(h.deps.edit).mockImplementationOnce(async (_link, request) => { h.accept(request); throw new Error("projection_network_error"); });
    await expect(h.sync()).rejects.toThrow();
    h.change(editShape("shape-a", 75)); h.restart(); await h.sync();
    expect(h.local()).toContainEqual(editShape("shape-a", 75));
    expect(h.stored.conflict?.code).toBe("projection_edit_recovery_conflict");
    expect(h.remote.objects["shape-a"].value).toEqual(editShape("shape-a", 40));
    await h.engine.resolve(h.unit.id, false);
    expect(h.local()).toContainEqual(editShape("shape-a", 40));
});

it("enforces receiver mode and rejects late writes after the mode fence changes", async () => {
    const h = editingHarness("receiver"); await h.sync();
    await expect(h.engine.setMode(h.unit.id, "one_way")).rejects.toThrow("projection_edit_read_only");
    h.change(editShape("shape-a", 40));
    h.remote.mode = "one_way"; h.remote.revision += 1; h.remote.modeRevision = h.remote.revision;
    await h.sync();
    expect(h.stored.conflict?.code).toBe("projection_edit_read_only");
    expect(h.deps.edit).not.toHaveBeenCalled();
    await expect(h.engine.resolve(h.unit.id, true)).rejects.toThrow("projection_edit_read_only");
    expect(h.local()).toContainEqual(editShape("shape-a", 40));
});

it("checkpoints before exhausting receipts without losing pending local edits", async () => {
    const h = editingHarness(); await h.sync(); h.remote.receiptCount = 224;
    h.change(editShape("shape-a", 40)); await h.sync();
    expect(h.local()).toContainEqual(editShape("shape-a", 40));
    await h.sync();
    expect(h.remote.objects["shape-a"].value).toEqual(editShape("shape-a", 40));
    expect(vi.mocked(h.deps.edit).mock.calls.map(([, request]) => request.operation)).toEqual(["checkpoint", "apply"]);
});

it("fences removal immediately and forgets durable state after an outstanding request settles", async () => {
    const h = editingHarness(); await h.sync(); h.change(editShape("shape-a", 40));
    const gate = deferred();
    vi.mocked(h.deps.edit).mockImplementationOnce(async (_link, request) => { await gate.promise; return h.accept(request); });
    const syncing = h.sync(); await vi.waitFor(() => expect(h.stored.pending).toBeDefined());
    h.removeUnit(); const removal = h.engine.remove(h.unit.id); gate.resolve();
    await expect(syncing).rejects.toThrow("projection_source_unavailable"); await removal;
    expect(h.stored).toBeUndefined(); expect(h.local()).toContainEqual(editShape("shape-a", 40));
});

it("does not replay a stopped binding through another target or stop a healthy association", async () => {
    const h = editingHarness(); await h.sync(); h.change(editShape("shape-a", 40));
    vi.mocked(h.deps.edit).mockRejectedValueOnce(new Error("projection_network_error"));
    await expect(h.sync()).rejects.toThrow();
    const oldId = h.unit.data.qrProjection!.envelope.projectionId;
    h.unit.data.qrProjection!.stopPending = true;
    await expect(h.sync()).rejects.toThrow("projection_edit_pending");
    h.unit.data.qrProjection = { ...h.unit.data.qrProjection!, stopPending: false,
        envelope: { ...h.unit.data.qrProjection!.envelope, projectionId: `projection:${"2".repeat(32)}` } };
    await h.sync();
    expect(h.stored.pending).toBeUndefined();
    expect(h.stored.conflict?.code).toBe("projection_edit_binding_stopped");
    expect(vi.mocked(h.deps.edit).mock.calls.filter(([, request]) => request.projectionId === oldId)).toHaveLength(1);
    await h.engine.resolve(h.unit.id, true);
    expect(h.remote.objects["shape-a"].value).toEqual(editShape("shape-a", 40));
});
