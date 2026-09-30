/** One per-Unit writer: durable intent precedes I/O; conflicts never silently rebase. */
import type { Unit } from "../types/unit";
import type { ProjectionResponse, QrProjectionLink } from "../types/qrProjection";
import type { ProjectionEditChange, ProjectionEditDocument, ProjectionEditMode, ProjectionEditRequest, ProjectionEditView } from "../types/projectionEdit";
import type { ProjectionEditJournal } from "./projectionEditJournal";
import type { ProjectionFrame } from "./qrProjectionSnapshot";
import type { requestProjection } from "./qrProjectionApi";
import { projectionAssociations } from "./projectionSenderBindings";
import { basisEditObjects, documentView, editChanges, projectionEditView, scaleEditObjects } from "./projectionEditGeometry";
import { ensureProjectionEditSource } from "./projectionEditSource";
import { commitProjectionEditView, editChangesRace, mergeEditChanges } from "./projectionEditMerge";

export interface ProjectionEditStatus { mode: ProjectionEditMode; revision?: number; pending: boolean; conflicts: number; error?: string }
export interface ProjectionEditDependencies {
    unit: (id: string) => Unit | undefined;
    generation: () => number;
    origin: () => Promise<string>;
    signature: (unit: Unit) => Promise<string>;
    render: (unit: Unit) => Promise<ProjectionFrame>;
    load: (id: string) => Promise<ProjectionEditJournal | undefined>;
    save: (record: ProjectionEditJournal) => Promise<ProjectionEditJournal>;
    forget: (id: string) => Promise<void>;
    edit: (link: QrProjectionLink, request: ProjectionEditRequest) => Promise<ProjectionEditDocument>;
    project: (link: QrProjectionLink, request: Parameters<typeof requestProjection>[0]) => Promise<ProjectionResponse>;
    publish: (link: QrProjectionLink, response: ProjectionResponse) => void;
    apply: (id: string, view: ProjectionEditView) => void;
    status: (id: string, status: ProjectionEditStatus | undefined) => void;
    release?: (id: string) => void;
}
const id = (prefix: string) => `${prefix}:${crypto.randomUUID().replaceAll("-", "")}`;
const code = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const active = (unit: Unit) => projectionAssociations(unit).map((entry) => entry.link).filter((link) => !link.stopped && !link.stopPending);
const origin = (link: QrProjectionLink) => link.offlineTransport?.origin ?? link.envelope.serverOrigin;
const conflicts = new Set(["projection_edit_object_conflict", "projection_edit_mode_conflict", "projection_edit_revision_conflict", "projection_edit_read_only", "projection_edit_log_full", "projection_edit_object_budget"]);

export function createProjectionEditing(deps: ProjectionEditDependencies) {
    const records = new Map<string, Promise<ProjectionEditJournal | undefined>>();
    const locks = new Map<string, Promise<unknown>>();
    const restored = new Set<string>();
    const owners = new Map<string, object>();
    let generation = deps.generation();
    let epoch = 0;
    const clear = () => {
        for (const unitId of owners.keys()) { deps.status(unitId, undefined); deps.release?.(unitId); }
        records.clear(); restored.clear(); owners.clear();
    };
    const refresh = () => {
        if (generation !== deps.generation()) { clear(); generation = deps.generation(); }
    };
    const load = (unitId: string) => {
        if (!records.has(unitId)) {
            if (records.size >= 64) throw new Error("projection_edit_journal_full");
            const promise = deps.load(unitId).then((record) => {
                if (record && records.get(unitId) === promise) restored.add(unitId);
                return record;
            }).catch((error: unknown) => {
                if (records.get(unitId) === promise) records.delete(unitId);
                throw error;
            });
            records.set(unitId, promise);
        }
        return records.get(unitId)!;
    };
    const show = (record: ProjectionEditJournal, error?: string) => deps.status(record.unitId, {
        mode: record.document?.mode ?? record.desiredMode ?? "one_way", revision: record.document?.revision,
        pending: !!record.pending || (record.desiredMode !== undefined && record.desiredMode !== record.document?.mode),
        conflicts: record.conflict ? Math.max(1, record.conflict.changes.length) : 0, error: error ?? record.conflict?.code,
    });
    const context = (unitId: string, current: () => boolean = () => true) => {
        const startGeneration = deps.generation(); const startEpoch = epoch;
        const owner = owners.get(unitId);
        const valid = () => startGeneration === deps.generation() && startEpoch === epoch && owners.get(unitId) === owner && !!deps.unit(unitId) && current();
        const check = () => { if (!valid()) throw new Error("projection_source_unavailable"); };
        const save = async (record: ProjectionEditJournal) => {
            check();
            let next: ProjectionEditJournal;
            try { next = await deps.save(record); }
            catch (error) {
                if (valid()) { records.delete(unitId); restored.delete(unitId); }
                throw error;
            }
            check();
            records.set(unitId, Promise.resolve(next)); show(next); return next;
        };
        const project: ProjectionEditDependencies["project"] = async (link, request) => {
            check(); const response = await deps.project(link, request); check(); deps.publish(link, response); return response;
        };
        const edit: ProjectionEditDependencies["edit"] = async (link, request) => { check(); const value = await deps.edit(link, request); check(); return value; };
        return { valid, check, save, project, edit };
    };
    const locked = async <T>(unitId: string, work: () => Promise<T>): Promise<T> => {
        refresh();
        if (!locks.has(unitId) && locks.size >= 64) throw new Error("projection_busy");
        if (!owners.has(unitId)) {
            if (owners.size >= 64) throw new Error("projection_edit_journal_full");
            owners.set(unitId, {});
        }
        const owner = owners.get(unitId); const startGeneration = deps.generation(); const startEpoch = epoch;
        const task = (locks.get(unitId) ?? Promise.resolve()).catch(() => {}).then(() => {
            if (startGeneration !== deps.generation() || startEpoch !== epoch || owners.get(unitId) !== owner) throw new Error("projection_source_unavailable");
            return work();
        });
        locks.set(unitId, task);
        try { return await task; } finally { if (locks.get(unitId) === task) locks.delete(unitId); }
    };
    const stage = async (unitId: string, mode: ProjectionEditMode, old: ProjectionEditJournal | undefined, ops: ReturnType<typeof context>) => {
        const unit = deps.unit(unitId)!;
        if (unit.data.qrProjection?.role === "receiver") throw new Error("projection_edit_read_only");
        const links = active(unit);
        const localOrigin = links[0] ? origin(links[0]) : await deps.origin(); ops.check();
        if (links.some((link) => link.envelope.protocol !== "neuro.qr-projection.v1" || origin(link) !== localOrigin)) throw new Error("projection_edit_mixed_origins");
        const signature = await deps.signature(unit);
        const view = projectionEditView(unit);
        const frame = await deps.render(unit); ops.check();
        if (signature !== await deps.signature(deps.unit(unitId)!)) throw new Error("projection_content_changed");
        return ops.save({ unitId, origin: localOrigin, storageRevision: old?.storageRevision ?? 0, sessionId: id("edit"),
            role: "source", view, desiredMode: mode, source: { frame, signature,
                initial: basisEditObjects(view, { digest: frame.digest, width: frame.snapshot.width, height: frame.snapshot.height }) } });
    };
    const queue = async (record: ProjectionEditJournal, link: QrProjectionLink, request: ProjectionEditRequest,
        view: ProjectionEditView, ops: ReturnType<typeof context>, remaining?: ProjectionEditChange[]) => ops.save({ ...record,
            pending: { link, request, view, ...(remaining?.length ? { remaining } : {}) } });

    const commitView = (record: ProjectionEditJournal, document: ProjectionEditDocument, observed: ProjectionEditView,
        overlay: ProjectionEditChange[], ops: ReturnType<typeof context>, force = false) =>
        commitProjectionEditView(record, document, observed, overlay, {
            save: ops.save,
            current: () => { ops.check(); return projectionEditView(deps.unit(record.unitId)!); },
            apply: (view) => { ops.check(); deps.apply(record.unitId, view); },
        }, force);

    async function drain(record: ProjectionEditJournal, ops: ReturnType<typeof context>): Promise<ProjectionEditJournal> {
        for (let batch = 0; record.pending && batch < 8; batch += 1) {
            const pending = record.pending;
            let document: ProjectionEditDocument;
            try { document = await ops.edit(pending.link, pending.request); }
            catch (reason) {
                if (pending.request.operation === "checkpoint" && code(reason) === "projection_edit_revision_conflict") return ops.save({ ...record, pending: undefined });
                if (!conflicts.has(code(reason))) throw reason;
                const current = projectionEditView(deps.unit(record.unitId)!);
                const changes = editChanges(record.view, current, record.document!.basis);
                return ops.save({ ...record, pending: undefined, conflict: { code: code(reason), changes } });
            }
            if (pending.request.operation === "apply" && pending.remaining?.length) {
                record = await queue({ ...record, document }, pending.link, { ...pending.request,
                    opId: id("op"), changes: pending.remaining.slice(0, 32) }, pending.view, ops, pending.remaining.slice(32));
                continue;
            }
            const current = projectionEditView(deps.unit(record.unitId)!);
            const acknowledged = pending.request.operation === "apply" ? pending.view : record.view;
            const later = editChanges(acknowledged, current, document.basis);
            const raced = editChangesRace(acknowledged, document, later);
            const overlay = mergeEditChanges(record.conflict?.changes ?? [], later);
            record = await commitView({ ...record, pending: undefined,
                desiredMode: document.mode === record.desiredMode ? undefined : record.desiredMode,
                ...(raced ? { conflict: { code: "projection_edit_object_conflict", changes: overlay } } : {}) }, document, current, overlay, ops, true);
        }
        return record;
    }

    const synchronize = (unitId: string, link: QrProjectionLink, response: ProjectionResponse, current: () => boolean) => locked(unitId, async () => {
        const ops = context(unitId, current);
        let record = await load(unitId); ops.check();
        if (!record && !response.editing) return false;
        try {
            const local = projectionEditView(deps.unit(unitId)!);
            if (!record) {
                if (link.role === "source") throw new Error("projection_edit_source_recovery_required");
                const document = response.editing!;
                record = await ops.save({ unitId, origin: origin(link), sessionId: document.sessionId, storageRevision: 0,
                    role: link.role, view: { ...local, objects: {} }, document });
            }
            if (record.origin !== origin(link) || record.role !== link.role) throw new Error("projection_edit_mixed_origins");
            if (record.source && record.source.signature !== await deps.signature(deps.unit(unitId)!)) throw new Error("projection_edit_basis_changed");
            ops.check();
            if (restored.delete(unitId) && record.document) {
                const changes = editChanges(record.view, local, record.document.basis);
                if (record.pending && !changes.length) {
                    ops.check();
                    deps.apply(unitId, { ...local, objects: scaleEditObjects(record.pending.view, local) });
                } else if (changes.length && (!record.pending || editChanges(record.pending.view, local, record.document.basis).length)) {
                    record = await ops.save({ ...record, conflict: { code: "projection_edit_recovery_conflict", changes } });
                }
            }
            if (record.source?.anchor && !record.document && !active(deps.unit(unitId)!).some((item) => item.envelope.projectionId === record!.source!.anchor!.envelope.projectionId)) {
                record = await ops.save({ ...record, source: { ...record.source, anchor: link } });
            }
            if (record.pending) {
                const pendingLink = projectionAssociations(deps.unit(unitId)!).find(({ link }) => link.envelope.projectionId === record!.pending!.link.envelope.projectionId)?.link;
                if (pendingLink?.stopPending) throw new Error("projection_edit_pending");
                if (!pendingLink || pendingLink.stopped) {
                    const changes = editChanges(record.view, projectionEditView(deps.unit(unitId)!), record.document!.basis);
                    record = await ops.save({ ...record, pending: undefined, conflict: { code: "projection_edit_binding_stopped", changes } });
                }
            }
            if (record.source) record = await ensureProjectionEditSource(record, link, response, ops);
            let document = response.editing ?? record.document!;
            if (document.sessionId !== record.sessionId || document.basis.digest !== record.document!.basis.digest) throw new Error("projection_edit_session_mismatch");
            if (document.revision < record.document!.revision) document = record.document!;
            deps.publish(link, response);
            if (!record.pending && record.desiredMode === document.mode) record = await ops.save({ ...record, desiredMode: undefined });
            if (!record.pending) {
                const view = projectionEditView(deps.unit(unitId)!);
                const reclaim = Object.keys(document.objects).length >= 240 && Object.values(document.objects).some((object) => object.value === null);
                if (record.role === "source" && (document.receiptCount >= 224 || reclaim)) {
                    record = await queue(record, link, { operation: "checkpoint", projectionId: link.envelope.projectionId,
                        sessionId: record.sessionId, expectedRevision: document.revision }, view, ops);
                } else if (record.role === "source" && record.desiredMode && record.desiredMode !== document.mode) {
                    record = await queue(record, link, { operation: "mode", projectionId: link.envelope.projectionId, sessionId: record.sessionId,
                        opId: id("op"), baseModeRevision: document.modeRevision, mode: record.desiredMode }, view, ops);
                } else if (!record.conflict) {
                    const changes = editChanges(record.view, view, record.document!.basis);
                    if (changes.length && (record.role === "source" || document.mode === "two_way")) {
                        record = await queue(record, link, { operation: "apply", projectionId: link.envelope.projectionId, sessionId: record.sessionId,
                            opId: id("op"), baseRevision: record.document!.revision, modeRevision: record.document!.modeRevision, changes: changes.slice(0, 32) }, view, ops, changes.slice(32));
                    } else if (changes.length) {
                        record = await ops.save({ ...record, conflict: { code: "projection_edit_read_only", changes } });
                    }
                }
            }
            if (record.pending) record = await drain(record, ops);
            else {
                const local = projectionEditView(deps.unit(unitId)!);
                const overlay = record.conflict ? editChanges(record.view, local, document.basis) : [];
                record = await commitView(record, document, local, overlay, ops);
            }
            show(record); return true;
        } catch (reason) { if (record && ops.valid()) show(record, code(reason)); throw reason; }
    });

    return {
        refresh,
        inspect: (unitId: string) => locked(unitId, async () => {
            const ops = context(unitId); const record = await load(unitId); ops.check();
            if (record) show(record);
        }),
        synchronize,
        setMode: (unitId: string, mode: ProjectionEditMode) => locked(unitId, async () => {
            const ops = context(unitId); let record = await load(unitId); ops.check();
            if (deps.unit(unitId)!.data.qrProjection?.role === "receiver") throw new Error("projection_edit_read_only");
            if (!record && mode === "one_way") return;
            if (!active(deps.unit(unitId)!).length && mode === "one_way") {
                await deps.forget(unitId); ops.check(); records.delete(unitId); restored.delete(unitId); deps.release?.(unitId); deps.status(unitId, undefined); return;
            }
            record = !record || !active(deps.unit(unitId)!).length ? await stage(unitId, mode, record, ops)
                : await ops.save({ ...record, desiredMode: mode });
            show(record);
        }),
        sendFrame: (unitId: string, fallback: () => Promise<ProjectionFrame>, destination?: { origin: string; protocol: string }) => locked(unitId, async () => {
            const ops = context(unitId); let record = await load(unitId); ops.check();
            if (!record?.source) return fallback();
            if (record.document && !active(deps.unit(unitId)!).length) record = await stage(unitId, record.desiredMode ?? record.document.mode, record, ops);
            if (record.source!.signature !== await deps.signature(deps.unit(unitId)!)) throw new Error("projection_edit_basis_changed");
            if (destination && (destination.origin !== record.origin || destination.protocol !== "neuro.qr-projection.v1")) throw new Error("projection_edit_mixed_origins");
            ops.check();
            return record.source!.frame;
        }),
        resolve: (unitId: string, keepLocal: boolean) => locked(unitId, async () => {
            const ops = context(unitId); let record = await load(unitId); ops.check();
            if (!record?.conflict || !record.document) return;
            if (record.pending) throw new Error("projection_edit_pending");
            const link = active(deps.unit(unitId)!)[0]; if (!link) throw new Error("projection_source_unavailable");
            const document = await ops.edit(link, { operation: "read", projectionId: link.envelope.projectionId });
            if (document.sessionId !== record.sessionId) throw new Error("projection_edit_session_mismatch");
            if (keepLocal && record.role === "receiver" && document.mode !== "two_way") throw new Error("projection_edit_read_only");
            const local = projectionEditView(deps.unit(unitId)!);
            const changes = keepLocal ? editChanges(record.view, local, document.basis) : [];
            const pending: ProjectionEditJournal["pending"] = changes.length ? {
                link, request: { operation: "apply", projectionId: link.envelope.projectionId, sessionId: record.sessionId,
                    opId: id("op"), baseRevision: document.revision, modeRevision: document.modeRevision, changes: changes.slice(0, 32) },
                view: documentView(document, local, changes), remaining: changes.slice(32),
            } : undefined;
            record = await commitView({ ...record, conflict: undefined, pending }, document, local, changes, ops, true);
            if (record.pending) record = await drain(record, ops);
            show(record);
        }),
        remove: (unitId: string) => {
            owners.delete(unitId); deps.release?.(unitId);
            return locked(unitId, async () => {
                await deps.forget(unitId); records.delete(unitId); restored.delete(unitId); owners.delete(unitId); deps.status(unitId, undefined);
            });
        },
        dispose() { epoch += 1; clear(); },
    };
}
