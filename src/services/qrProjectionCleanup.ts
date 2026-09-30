import type { OfflineProjectionTransport, ProjectionEnvelope } from "../types/qrProjection";
import { unlinkProjection } from "./qrProjectionApi";
import { parseProjectionEnvelope, parseOfflineTransport } from "./qrProjectionProtocol";
import { forgetPreparedProjection, loadCancelledCreates } from "./projectionCreateJournal";

const STORAGE_KEY = "hook.qr-projection.pending-unlinks.v1";
const MAX_PENDING = 128;
interface Pending { envelope: ProjectionEnvelope; offlineTransport?: OfflineProjectionTransport; nextAt: number; failures: number }
const pending = new Map<string, Pending>();
let loaded = false;

function load(): void {
    if (loaded) return;
    loaded = true;
    try {
        const text = localStorage.getItem(STORAGE_KEY);
        if (!text || text.length > 512 * 1024) return;
        const values: unknown = JSON.parse(text);
        if (!Array.isArray(values) || values.length > MAX_PENDING) return;
        for (const value of values) {
            try {
                const routed = value && typeof value === "object" && "offlineTransport" in value;
                const envelope = parseProjectionEnvelope(routed ? value.envelope : value);
                const offlineTransport = routed ? parseOfflineTransport(value.offlineTransport) : undefined;
                if (offlineTransport && envelope.protocol !== "neuro.qr-projection.v1") continue;
                pending.set(`${offlineTransport?.origin ?? envelope.serverOrigin}/${offlineTransport ? "offline/" : ""}${envelope.projectionId}`, { envelope, offlineTransport, nextAt: 0, failures: 0 });
            } catch { /* Invalid persisted cleanup records have no network authority. */ }
        }
    } catch { /* The current process still owns cleanup when browser storage is unavailable. */ }
}

function persist(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...pending.values()].map((entry) => entry.offlineTransport ? { envelope: entry.envelope, offlineTransport: entry.offlineTransport } : entry.envelope))); }
    catch { /* Keep the in-memory owner and retry during this process. */ }
}

export function queueProjectionUnlink(envelope: ProjectionEnvelope, transport?: OfflineProjectionTransport): void {
    queueProjectionUnlinks([{ envelope, offlineTransport: transport }]);
}

export function queueProjectionUnlinks(entries: { envelope: ProjectionEnvelope; offlineTransport?: OfflineProjectionTransport }[]): void {
    load();
    if (entries.length > MAX_PENDING) throw new Error("projection_cleanup_limit");
    const additions = new Map<string, Pending>();
    for (const entry of entries) {
        const envelope = parseProjectionEnvelope(entry.envelope);
        const offlineTransport = entry.offlineTransport ? parseOfflineTransport(entry.offlineTransport) : undefined;
        if (offlineTransport && envelope.protocol !== "neuro.qr-projection.v1") throw new Error("projection_invalid_request");
        const key = `${offlineTransport?.origin ?? envelope.serverOrigin}/${offlineTransport ? "offline/" : ""}${envelope.projectionId}`;
        additions.set(key, { envelope, offlineTransport, nextAt: 0, failures: 0 });
    }
    if (new Set([...pending.keys(), ...additions.keys()]).size > MAX_PENDING) throw new Error("projection_cleanup_limit");
    // Enqueue all targets or none: failed deletion must not unlink part of a still-live unit.
    for (const [key, entry] of additions) pending.set(key, entry);
    persist();
}

export function createProjectionCleanup(unlink = unlinkProjection) {
    load();
    let disposed = false;
    let busy = false;
    let recoverAt = 0;
    const tick = async () => {
        if (disposed || busy) return;
        if (pending.size < MAX_PENDING && recoverAt <= Date.now()) {
            busy = true;
            recoverAt = Date.now() + 5000;
            try {
                const cancelled = await loadCancelledCreates();
                if (disposed) return;
                const missing = cancelled.filter((entry) => !pending.has(`${entry.origin}/${entry.target ? "offline/" : ""}${entry.envelope.projectionId}`));
                queueProjectionUnlinks(missing.slice(0, MAX_PENDING - pending.size).map((entry) => ({ envelope: entry.envelope,
                    ...(entry.target ? { offlineTransport: { origin: entry.origin } } : {}) })));
            } catch { /* Durable cancellation remains available for the next tick. */ }
            finally { busy = false; }
            if (disposed) return;
        }
        const next = [...pending.entries()].find(([, entry]) => entry.nextAt <= Date.now());
        if (!next) return;
        const [key, entry] = next;
        busy = true;
        let complete = false;
        try {
            await unlink(entry.envelope.projectionId, entry.envelope.serverOrigin, entry.envelope.protocol, ...(entry.offlineTransport ? [entry.offlineTransport] as const : []));
            complete = true;
        } catch (error) {
            const code = error instanceof Error ? error.message : String(error);
            complete = ["projection_not_found", "projection_unlinked", "projection_access_denied", "projection_source_revoked", "projection_account_mismatch", "projection_peer_revoked"].includes(code);
            entry.failures = Math.min(6, entry.failures + 1);
            entry.nextAt = Date.now() + Math.min(30_000, 1000 * 2 ** entry.failures);
        } finally {
            if (!disposed && pending.get(key) === entry && complete) {
                try {
                    await forgetPreparedProjection(entry.offlineTransport?.origin ?? entry.envelope.serverOrigin, entry.envelope.projectionId);
                    if (!disposed && pending.get(key) === entry) { pending.delete(key); persist(); }
                } catch { entry.nextAt = Date.now() + 5000; }
            }
            busy = false;
        }
    };
    const timer = setInterval(() => void tick(), 1000);
    void tick();
    return { dispose() { disposed = true; clearInterval(timer); } };
}
