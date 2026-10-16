/** Durable-before-send journal, with bounded metadata accounting and transaction CAS. */
import type { QrProjectionLink } from "../types/qrProjection";
import type { ProjectionEditChange, ProjectionEditDocument, ProjectionEditMode, ProjectionEditObjects, ProjectionEditRequest, ProjectionEditView } from "../types/projectionEdit";
import type { ProjectionFrame } from "./qrProjectionSnapshot";
import { parseProjectionSnapshot, projectionOrigin, sanitizeProjectionLink } from "./qrProjectionProtocol";
import { editIdentifier, editRecord, parseProjectionEditDocument, parseProjectionEditObjects, parseProjectionEditRequest, parseProjectionAnnotation } from "./projectionEditProtocol";

export interface ProjectionEditJournal {
    unitId: string;
    origin: string;
    sessionId: string;
    storageRevision: number;
    role: "source" | "receiver";
    view: ProjectionEditView;
    document?: ProjectionEditDocument;
    source?: { frame: ProjectionFrame; signature: string; initial: ProjectionEditObjects; anchor?: QrProjectionLink };
    desiredMode?: ProjectionEditMode;
    pending?: { link: QrProjectionLink; request: ProjectionEditRequest; view: ProjectionEditView; remaining?: ProjectionEditChange[] };
    conflict?: { code: string; changes: ProjectionEditChange[] };
}
const storageError = () => new Error("projection_edit_storage_unavailable");
function view(value: unknown): ProjectionEditView {
    if (!editRecord(value) || typeof value.w !== "number" || typeof value.h !== "number" || !Number.isFinite(value.w) || !Number.isFinite(value.h)
        || value.w <= 0 || value.h <= 0 || value.w > 1_000_000 || value.h > 1_000_000) throw storageError();
    return { w: value.w, h: value.h, objects: parseProjectionEditObjects(value.objects) };
}
function parse(value: unknown): ProjectionEditJournal {
    if (!editRecord(value) || !editIdentifier(value.unitId) || typeof value.origin !== "string" || projectionOrigin(value.origin) !== value.origin
        || typeof value.sessionId !== "string" || !/^edit:[a-f0-9]{32}$/.test(value.sessionId) || !Number.isSafeInteger(value.storageRevision)
        || (value.storageRevision as number) < 0 || !["source", "receiver"].includes(String(value.role))) throw storageError();
    view(value.view);
    if (value.document !== undefined && parseProjectionEditDocument(value.document).sessionId !== value.sessionId) throw storageError();
    const link = (raw: unknown) => {
        const result = sanitizeProjectionLink(raw, value.unitId as string);
        if (!result || (result.offlineTransport?.origin ?? result.envelope.serverOrigin) !== value.origin || result.role !== value.role) throw storageError();
        return result;
    };
    if (value.role === "source") {
        if (!editRecord(value.source) || !editRecord(value.source.frame) || typeof value.source.signature !== "string" || !/^[a-f0-9]{64}$/.test(value.source.signature)
            || typeof value.source.frame.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.source.frame.digest)) throw storageError();
        const snapshot = parseProjectionSnapshot(value.source.frame.snapshot); parseProjectionEditObjects(value.source.initial);
        if (value.document !== undefined) {
            const document = parseProjectionEditDocument(value.document);
            if (document.basis.digest !== value.source.frame.digest || document.basis.width !== snapshot.width || document.basis.height !== snapshot.height) throw storageError();
        }
        if (value.source.anchor !== undefined) link(value.source.anchor);
    } else if (value.source !== undefined || value.document === undefined) throw storageError();
    if (value.desiredMode !== undefined && !["one_way", "two_way"].includes(String(value.desiredMode))) throw storageError();
    if (value.pending !== undefined) {
        if (!editRecord(value.pending)) throw storageError();
        const request = parseProjectionEditRequest(value.pending.request);
        if (request.projectionId !== link(value.pending.link).envelope.projectionId || ("sessionId" in request && request.sessionId !== value.sessionId)) throw storageError();
        view(value.pending.view);
        if (value.pending.remaining !== undefined && (!Array.isArray(value.pending.remaining) || value.pending.remaining.length > 256)) throw storageError();
        for (const item of value.pending.remaining as unknown[] ?? []) if (!editRecord(item) || !editIdentifier(item.objectId)
            || (item.value !== null && parseProjectionAnnotation(item.value).id !== item.objectId)) throw storageError();
    }
    if (value.conflict !== undefined) {
        if (!editRecord(value.conflict) || typeof value.conflict.code !== "string" || !/^projection_[a-z_]{1,80}$/.test(value.conflict.code)
            || !Array.isArray(value.conflict.changes) || value.conflict.changes.length > 256) throw storageError();
        for (const item of value.conflict.changes) if (!editRecord(item) || !editIdentifier(item.objectId)
            || (item.value !== null && parseProjectionAnnotation(item.value).id !== item.objectId)) throw storageError();
    }
    return value as unknown as ProjectionEditJournal;
}

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") { reject(storageError()); return; }
        let settled = false;
        const request = indexedDB.open("hook.projection-edit.v1", 1);
        const timer = setTimeout(() => { settled = true; reject(storageError()); }, 10_000);
        request.onupgradeneeded = () => {
            if (settled) { request.transaction?.abort(); return; }
            request.result.createObjectStore("entries", { keyPath: "unitId" });
            request.result.createObjectStore("sizes", { keyPath: "unitId" });
        };
        request.onblocked = request.onerror = () => { settled = true; clearTimeout(timer); reject(storageError()); };
        request.onsuccess = () => {
            clearTimeout(timer);
            if (settled) { request.result.close(); return; }
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
    });
}

async function transaction<T>(mode: IDBTransactionMode, work: (entries: IDBObjectStore, sizes: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
    const db = await open();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(["entries", "sizes"], mode, { durability: "strict" });
            let value: T; let failure: unknown; let completed = false;
            const fail = (error: unknown) => {
                failure = error;
                try { tx.abort(); } catch { clearTimeout(timer); reject(failure); }
            };
            const timer = setTimeout(() => fail(storageError()), 10_000);
            tx.oncomplete = () => { clearTimeout(timer); if (completed) resolve(value); else reject(storageError()); };
            tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(failure ?? storageError()); };
            try { work(tx.objectStore("entries"), tx.objectStore("sizes"), (result) => { value = result; completed = true; }, fail); }
            catch (error) { fail(error); }
        });
    } finally { db.close(); }
}

export const loadProjectionEdit = (unitId: string): Promise<ProjectionEditJournal | undefined> => transaction("readonly", (entries, _sizes, done, fail) => {
    const request = entries.get(unitId);
    request.onsuccess = () => { try { done(request.result === undefined ? undefined : parse(request.result)); } catch (error) { fail(error); } };
});

export const saveProjectionEdit = (record: ProjectionEditJournal): Promise<ProjectionEditJournal> => {
    const next = parse(JSON.parse(JSON.stringify({ ...record, storageRevision: record.storageRevision + 1 })));
    const bytes = new TextEncoder().encode(JSON.stringify(next)).byteLength;
    if (bytes > 8 * 1024 * 1024) return Promise.reject(new Error("projection_edit_journal_full"));
    return transaction("readwrite", (entries, sizes, done, fail) => {
        const previous = entries.get(next.unitId);
        previous.onsuccess = () => {
            if ((previous.result?.storageRevision ?? 0) !== record.storageRevision) { fail(new Error("projection_edit_storage_conflict")); return; }
            const weights = sizes.getAll(undefined, 65);
            weights.onsuccess = () => {
                const rows: { unitId: string; bytes: number }[] = weights.result;
                if (rows.length > 64 || (rows.length === 64 && !previous.result)
                    || rows.some((row) => !Number.isSafeInteger(row.bytes) || row.bytes < 0)
                    || rows.filter((row) => row.unitId !== next.unitId).reduce((sum, row) => sum + row.bytes, bytes) > 64 * 1024 * 1024) {
                    fail(new Error("projection_edit_journal_full")); return;
                }
                try { entries.put(next); sizes.put({ unitId: next.unitId, bytes }); done(next); }
                catch (error) { fail(error); }
            };
        };
    });
};

export const forgetProjectionEdit = (unitId: string): Promise<void> => transaction("readwrite", (entries, sizes, done) => {
    entries.delete(unitId); sizes.delete(unitId); done(undefined);
});
