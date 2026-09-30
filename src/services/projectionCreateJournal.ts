import type { OfflineProjectionTarget, ProjectionEnvelope, ProjectionSnapshot } from "../types/qrProjection";
import { parseProjectionEnvelope, parseProjectionSnapshot, projectionOrigin } from "./qrProjectionProtocol";

export interface PreparedProjectionCreate {
    key: string; origin: string; unitId: string; targetDeviceId: string;
    target?: OfflineProjectionTarget;
    envelope: ProjectionEnvelope; snapshot: ProjectionSnapshot; cancelled?: boolean;
}
const DATABASE = "hook.projection-create.v1";
const STORE = "requests";
const MAX_RECORDS = 64;
const MAX_BYTES = 48 * 1024 * 1024;
const storageError = () => new Error("projection_create_storage_unavailable");
export const preparedCreateKey = (origin: string, unitId: string, targetDeviceId: string, target?: OfflineProjectionTarget): string =>
    JSON.stringify([projectionOrigin(origin), unitId, target?.peerId ?? "", target?.remoteDeviceId ?? targetDeviceId]);

function validate(value: unknown): PreparedProjectionCreate {
    if (!value || typeof value !== "object" || !("origin" in value) || !("unitId" in value)
        || !("targetDeviceId" in value) || !("envelope" in value) || !("snapshot" in value) || !("key" in value)
        || typeof value.origin !== "string" || typeof value.unitId !== "string" || typeof value.targetDeviceId !== "string"
        || !/^[A-Za-z0-9._:/-]{1,160}$/.test(value.targetDeviceId)) throw storageError();
    const envelope = parseProjectionEnvelope(value.envelope);
    const snapshot = parseProjectionSnapshot(value.snapshot);
    let target: OfflineProjectionTarget | undefined;
    if ("target" in value && value.target !== undefined) {
        const remote = value.target;
        if (!remote || typeof remote !== "object" || !("peerId" in remote) || !("remoteDeviceId" in remote)
            || typeof remote.peerId !== "string" || !/^loom-[a-f0-9]{64}$/.test(remote.peerId)
            || typeof remote.remoteDeviceId !== "string" || !/^[A-Za-z0-9._:/-]{1,160}$/.test(remote.remoteDeviceId)) throw storageError();
        target = { peerId: remote.peerId, remoteDeviceId: remote.remoteDeviceId };
    }
    const key = preparedCreateKey(value.origin, value.unitId, value.targetDeviceId, target);
    if (value.key !== key || envelope.protocol !== "neuro.qr-projection.v1" || envelope.serverOrigin !== value.origin
        || envelope.source.unitId !== value.unitId) throw storageError();
    return { key, origin: value.origin, unitId: value.unitId, targetDeviceId: value.targetDeviceId,
        ...(target ? { target } : {}), envelope, snapshot, cancelled: "cancelled" in value && value.cancelled === true };
}

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") { reject(storageError()); return; }
        const request = indexedDB.open(DATABASE, 1);
        let settled = false;
        const timeout = setTimeout(() => { settled = true; reject(storageError()); }, 10_000);
        request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "key" }); };
        request.onerror = request.onblocked = () => { settled = true; clearTimeout(timeout); reject(storageError()); };
        request.onsuccess = () => {
            clearTimeout(timeout);
            if (settled) { request.result.close(); return; }
            request.result.onversionchange = () => request.result.close();
            resolve(request.result);
        };
    });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    const db = await open();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(STORE, mode, { durability: "strict" });
            let value: T;
            let failure: Error | undefined;
            const timeout = setTimeout(() => { try { tx.abort(); } catch { /* Already settled. */ } }, 10_000);
            tx.oncomplete = () => { clearTimeout(timeout); resolve(value); };
            tx.onabort = tx.onerror = () => { clearTimeout(timeout); reject(failure ?? storageError()); };
            const fail = (error: Error) => { failure = error; tx.abort(); };
            try { run(tx.objectStore(STORE), (result) => { value = result; }, fail); }
            catch { fail(storageError()); }
        });
    } finally { db.close(); }
}

export function loadPreparedCreate(key: string): Promise<PreparedProjectionCreate | undefined> {
    return transact("readonly", (store, done, fail) => {
        const request = store.get(key);
        request.onsuccess = () => { try { done(request.result === undefined ? undefined : validate(request.result)); } catch { fail(storageError()); } };
    });
}

/** Immutable first-writer wins, committed before any create request can leave Hook. */
export function savePreparedCreate(value: PreparedProjectionCreate): Promise<PreparedProjectionCreate> {
    const record = validate(value);
    return transact("readwrite", (store, done, fail) => {
        const request = store.getAll(undefined, MAX_RECORDS + 1);
        request.onsuccess = () => {
            try {
                const records = (request.result as unknown[]).map(validate);
                const existing = records.find((entry) => entry.key === record.key);
                if (existing) { done(existing); return; }
                if (records.length >= MAX_RECORDS || [...records, record].reduce((sum, entry) => sum + entry.snapshot.imageBase64.length + 4096, 0) > MAX_BYTES) {
                    fail(new Error("projection_create_journal_full")); return;
                }
                store.add(record); done(record);
            } catch { fail(storageError()); }
        };
    });
}

export function cancelPreparedCreates(unitId: string, keep: ReadonlySet<string>): Promise<PreparedProjectionCreate[]> {
    return transact("readwrite", (store, done, fail) => {
        const request = store.getAll(undefined, MAX_RECORDS + 1);
        request.onsuccess = () => {
            try {
                if (request.result.length > MAX_RECORDS) throw storageError();
                const cancelled = (request.result as unknown[]).map(validate).filter((entry) => entry.unitId === unitId && !keep.has(entry.envelope.projectionId));
                for (const entry of cancelled) { entry.cancelled = true; store.put(entry); }
                done(cancelled);
            } catch { fail(storageError()); }
        };
    });
}

export function cancelPreparedCreate(key: string): Promise<void> {
    return transact("readwrite", (store, done, fail) => {
        const request = store.get(key);
        request.onsuccess = () => {
            try {
                if (request.result !== undefined) { const entry = validate(request.result); entry.cancelled = true; store.put(entry); }
                done(undefined);
            } catch { fail(storageError()); }
        };
    });
}

/** Cancellation is a durable outbox even when the localStorage cleanup queue is full. */
export async function loadCancelledCreates(): Promise<PreparedProjectionCreate[]> {
    if (typeof indexedDB === "undefined") return [];
    return transact("readonly", (store, done, fail) => {
        const request = store.getAll(undefined, MAX_RECORDS + 1);
        request.onsuccess = () => {
            try {
                if (request.result.length > MAX_RECORDS) throw storageError();
                done((request.result as unknown[]).map(validate).filter((entry) => entry.cancelled));
            } catch { fail(storageError()); }
        };
    });
}

export async function forgetPreparedProjection(origin: string, projectionId: string): Promise<void> {
    if (typeof indexedDB === "undefined") return; // No journal can exist in non-WebView test hosts.
    return transact("readwrite", (store, done, fail) => {
        const request = store.getAll(undefined, MAX_RECORDS + 1);
        request.onsuccess = () => {
            try {
                if (request.result.length > MAX_RECORDS) throw storageError();
                for (const entry of (request.result as unknown[]).map(validate)) {
                    if (entry.origin === origin && entry.envelope.projectionId === projectionId) store.delete(entry.key);
                }
                done(undefined);
            } catch { fail(storageError()); }
        };
    });
}
