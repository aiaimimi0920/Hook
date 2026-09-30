import { vi } from "vitest";
import type { ProjectionEditDocument, ProjectionEditRequest } from "../../src/types/projectionEdit";
import type { StickerShapeAnnotation } from "../../src/types/stickerEditing";
import type { ProjectionEditJournal } from "../../src/services/projectionEditJournal";
import { createProjectionEditing, type ProjectionEditDependencies } from "../../src/services/projectionEditEngine";
import { projectionResponse, projectionUnit } from "./qrProjection";

export const editShape = (id = "shape-a", x = 10): StickerShapeAnnotation => ({
    id, type: "rect", x, y: 20, w: 30, h: 25, zIndex: 1, style: { color: "#d9ff38", width: 2 },
});
export const editDocument = (): ProjectionEditDocument => ({
    schema: "neuro.projection-edit.v1", sessionId: `edit:${"1".repeat(32)}`,
    basis: { digest: "a".repeat(64), width: 120, height: 100 },
    revision: 2, modeRevision: 2, checkpointRevision: 1, receiptCount: 1, mode: "two_way",
    objects: { "shape-a": { revision: 1, value: editShape() } },
});
export const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
};

export function editingHarness(role: "source" | "receiver" = "source") {
    const unit = projectionUnit(role);
    unit.data.annotationState = { elements: [editShape()], serialCounter: 1 };
    let remote = editDocument();
    let generation = 0;
    let present = true;
    const frame = { digest: remote.basis.digest, snapshot: { imageBase64: btoa("a"), width: 120, height: 100 } };
    let stored: ProjectionEditJournal | undefined = {
        unitId: unit.id, origin: unit.data.qrProjection!.envelope.serverOrigin, sessionId: remote.sessionId,
        storageRevision: 1, role, document: structuredClone(remote),
        view: { w: 120, h: 100, objects: { "shape-a": editShape() } },
        ...(role === "source" ? { source: { frame, signature: "basis", initial: { "shape-a": editShape() }, anchor: unit.data.qrProjection! } } : {}),
    };
    const receipts = new Map<string, string>();
    const accept = (request: ProjectionEditRequest) => {
        if (request.operation === "read" || request.operation === "initialize" || request.operation === "attach") return structuredClone(remote);
        if ("opId" in request && receipts.has(request.opId)) {
            if (receipts.get(request.opId) !== JSON.stringify(request)) throw new Error("projection_edit_operation_reused");
            return structuredClone(remote);
        }
        if (request.operation === "apply") {
            if (request.modeRevision !== remote.modeRevision) throw new Error("projection_edit_mode_conflict");
            if (role === "receiver" && remote.mode !== "two_way") throw new Error("projection_edit_read_only");
            if (request.changes.some((change) => (remote.objects[change.objectId]?.revision ?? 0) > request.baseRevision)) throw new Error("projection_edit_object_conflict");
            remote.revision += 1;
            for (const change of request.changes) remote.objects[change.objectId] = { value: change.value, revision: remote.revision };
        } else if (request.operation === "mode") {
            if (request.baseModeRevision !== remote.modeRevision) throw new Error("projection_edit_mode_conflict");
            remote.mode = request.mode; remote.revision += 1; remote.modeRevision = remote.revision;
        } else {
            if (request.expectedRevision !== remote.revision) throw new Error("projection_edit_revision_conflict");
            remote.revision += 1; remote.modeRevision = remote.revision; remote.checkpointRevision = remote.revision;
            remote.objects = Object.fromEntries(Object.entries(remote.objects).filter(([, object]) => object.value));
            receipts.clear(); remote.receiptCount = 0;
        }
        if ("opId" in request) { receipts.set(request.opId, JSON.stringify(request)); remote.receiptCount += 1; }
        return structuredClone(remote);
    };
    const deps: ProjectionEditDependencies = {
        unit: () => present ? unit : undefined, generation: () => generation, origin: async () => stored!.origin,
        signature: vi.fn(async () => "basis"), render: vi.fn(async () => frame),
        load: vi.fn(async () => structuredClone(stored)),
        save: vi.fn<ProjectionEditDependencies["save"]>(async (record) => {
            if ((stored?.storageRevision ?? 0) !== record.storageRevision) throw new Error("projection_edit_storage_conflict");
            const next = structuredClone({ ...record, storageRevision: record.storageRevision + 1 });
            stored = next;
            return structuredClone(next);
        }),
        forget: vi.fn(async () => { stored = undefined; }),
        edit: vi.fn<ProjectionEditDependencies["edit"]>(async (_link, request) => accept(request)),
        project: vi.fn(async () => ({ ...projectionResponse(), editing: structuredClone(remote) })),
        publish: vi.fn(), status: vi.fn(),
        apply: vi.fn<ProjectionEditDependencies["apply"]>((_id, view) => { unit.data.annotationState = { elements: Object.values(view.objects), serialCounter: 1 }; }),
    };
    let engine = createProjectionEditing(deps);
    return {
        unit, deps, frame, accept, get engine() { return engine; }, get remote() { return remote; },
        get stored(): ProjectionEditJournal { return stored!; }, set stored(value: ProjectionEditJournal | undefined) { stored = value; },
        local: () => unit.data.annotationState!.elements,
        change: (shape: StickerShapeAnnotation) => {
            unit.data.annotationState!.elements = [...unit.data.annotationState!.elements.filter((item) => item.id !== shape.id), shape];
        },
        replaceWorkspace: () => { generation += 1; }, removeUnit: () => { present = false; },
        restart: () => { engine.dispose(); engine = createProjectionEditing(deps); },
        sync: () => engine.synchronize(unit.id, unit.data.qrProjection!, { ...projectionResponse(), editing: structuredClone(remote) }, () => present),
    };
}
