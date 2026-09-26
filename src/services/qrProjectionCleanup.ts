import type { ProjectionEnvelope } from "../types/qrProjection";
import { unlinkProjection } from "./qrProjectionApi";
import { parseProjectionEnvelope } from "./qrProjectionProtocol";

const STORAGE_KEY = "hook.qr-projection.pending-unlinks.v1";
const MAX_PENDING = 128;
interface Pending { envelope: ProjectionEnvelope; nextAt: number; failures: number }
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
                const envelope = parseProjectionEnvelope(value);
                pending.set(`${envelope.serverOrigin}/${envelope.projectionId}`, { envelope, nextAt: 0, failures: 0 });
            } catch { /* Invalid persisted cleanup records have no network authority. */ }
        }
    } catch { /* The current process still owns cleanup when browser storage is unavailable. */ }
}

function persist(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...pending.values()].map((entry) => entry.envelope))); }
    catch { /* Keep the in-memory owner and retry during this process. */ }
}

export function queueProjectionUnlink(envelope: ProjectionEnvelope): void {
    load();
    const key = `${envelope.serverOrigin}/${envelope.projectionId}`;
    if (!pending.has(key) && pending.size >= MAX_PENDING) throw new Error("projection_cleanup_limit");
    // Replacing the entry also invalidates a cleanup reply that preceded a late acceptance.
    pending.set(key, { envelope: parseProjectionEnvelope(envelope), nextAt: 0, failures: 0 });
    persist();
}

export function createProjectionCleanup(unlink = unlinkProjection) {
    load();
    let disposed = false;
    let busy = false;
    const tick = async () => {
        if (disposed || busy) return;
        const next = [...pending.entries()].find(([, entry]) => entry.nextAt <= Date.now());
        if (!next) return;
        const [key, entry] = next;
        busy = true;
        let complete = false;
        try {
            await unlink(entry.envelope.projectionId, entry.envelope.serverOrigin, entry.envelope.protocol);
            complete = true;
        } catch (error) {
            const code = error instanceof Error ? error.message : String(error);
            complete = ["projection_not_found", "projection_unlinked", "projection_access_denied", "projection_source_revoked", "projection_account_mismatch"].includes(code);
            entry.failures = Math.min(6, entry.failures + 1);
            entry.nextAt = Date.now() + Math.min(30_000, 1000 * 2 ** entry.failures);
        } finally {
            if (!disposed && pending.get(key) === entry && complete) { pending.delete(key); persist(); }
            busy = false;
        }
    };
    const timer = setInterval(() => void tick(), 1000);
    void tick();
    return { dispose() { disposed = true; clearInterval(timer); } };
}
