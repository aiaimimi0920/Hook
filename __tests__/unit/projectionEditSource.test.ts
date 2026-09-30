import { expect, it, vi } from "vitest";
import { ensureProjectionEditSource, type ProjectionEditSourceOperations } from "../../src/services/projectionEditSource";
import type { ProjectionEditDocument } from "../../src/types/projectionEdit";
import type { ProjectionEditJournal } from "../../src/services/projectionEditJournal";
import { editDocument, editingHarness } from "../fixtures/projectionEdit";
import { projectionResponse } from "../fixtures/qrProjection";

function sourceHarness() {
    const h = editingHarness();
    let record: ProjectionEditJournal = { ...h.stored, document: undefined };
    record.source!.frame.digest = "b".repeat(64);
    let document: ProjectionEditDocument | undefined;
    const request = projectionResponse();
    const ops: ProjectionEditSourceOperations = {
        valid: () => true,
        save: vi.fn<ProjectionEditSourceOperations["save"]>(async (value) => { record = { ...value, storageRevision: record.storageRevision + 1 }; return record; }),
        project: vi.fn<ProjectionEditSourceOperations["project"]>(async (_link, operation) => {
            if (document) throw new Error("projection_edit_snapshot_locked");
            if (operation.kind !== "update") throw new Error("unexpected operation");
            return { ...request, revision: operation.revision, digest: record.source!.frame.digest };
        }),
        edit: vi.fn<ProjectionEditSourceOperations["edit"]>(async (_link, operation) => {
            if (operation.operation === "read") {
                if (!document) throw new Error("projection_edit_not_found");
                return document;
            }
            document = { ...editDocument(), basis: { ...editDocument().basis, digest: record.source!.frame.digest } };
            return document;
        }),
    };
    return { h, request, ops, record: () => record, document: () => document };
}

it("pins the anchor, probes support and separates the base exactly once before initialization", async () => {
    const h = sourceHarness();
    const record = await ensureProjectionEditSource(h.record(), h.h.unit.data.qrProjection!, h.request, h.ops);
    expect(record.document?.basis.digest).toBe("b".repeat(64));
    expect(h.ops.project).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.ops.edit).mock.calls.map(([, request]) => request.operation)).toEqual(["read", "initialize"]);
});

it("recovers a lost initialization reply with the same durable session without replacing a locked base", async () => {
    const h = sourceHarness();
    const edit = vi.mocked(h.ops.edit).getMockImplementation()!;
    vi.mocked(h.ops.edit).mockImplementation(async (link, request) => {
        const result = await edit(link, request);
        if (request.operation === "initialize") throw new Error("projection_network_error");
        return result;
    });
    await expect(ensureProjectionEditSource(h.record(), h.h.unit.data.qrProjection!, h.request, h.ops)).rejects.toThrow("projection_network_error");
    const record = await ensureProjectionEditSource(h.record(), h.h.unit.data.qrProjection!, h.request, h.ops);
    expect(record.sessionId).toBe(h.document()?.sessionId);
    expect(h.ops.project).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.ops.edit).mock.calls.filter(([, request]) => request.operation === "initialize")).toHaveLength(1);
});

it("does not mutate a legacy PNG when its Loom has no edit endpoint", async () => {
    const h = sourceHarness();
    vi.mocked(h.ops.edit).mockRejectedValue(new Error("route_not_found"));
    await expect(ensureProjectionEditSource(h.record(), h.h.unit.data.qrProjection!, h.request, h.ops)).rejects.toThrow("route_not_found");
    expect(h.ops.project).not.toHaveBeenCalled();
});
