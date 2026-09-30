import type { Unit } from "../types/unit";
import type { ProjectionEnvelope, ProjectionResponse, QrProjectionLink } from "../types/qrProjection";
import type { requestProjection, unlinkProjection } from "./qrProjectionApi";
import type { ProjectionFrame } from "./qrProjectionSnapshot";
import { projectionAssociations, projectionBindingStatusKey } from "./projectionSenderBindings";
import { createProjectionFrameCache } from "./projectionFrameCache";

export interface ProjectionSyncStatus {
    phase: "waiting" | "connected" | "syncing" | "retrying" | "stopping" | "stopped";
    error?: string;
    transport?: ProjectionResponse["transport"];
    delivery?: ProjectionResponse["delivery"];
}
export interface ProjectionSyncDependencies {
    units: () => readonly Unit[];
    generation: () => number;
    onUnitRemoved: (listener: (unitId: string) => void) => () => void;
    signature: (unit: Unit) => string;
    render: (unit: Unit) => Promise<ProjectionFrame>;
    request: typeof requestProjection;
    unlink: typeof unlinkProjection;
    patch: (unitId: string, link: QrProjectionLink | undefined, imageBase64?: string, bindingKey?: string) => void;
    status: (unitId: string, status: ProjectionSyncStatus | undefined) => void;
    edit?: (unitId: string, link: QrProjectionLink, response: ProjectionResponse, current: () => boolean) => Promise<boolean>;
    now?: () => number;
}
interface Work {
    id: string;
    unitId: string;
    key?: string;
    statusKey: string;
    generation: number;
    busy: boolean;
    failures: number;
    nextAt: number;
    signature?: string;
}

const terminalErrors = new Set([
    "projection_unlinked", "projection_invitation_expired", "projection_source_revoked",
    "projection_access_denied", "projection_not_found", "projection_source_mismatch", "projection_rejected", "projection_peer_revoked",
]);
const errorCode = (error: unknown) => error instanceof Error ? error.message : String(error);
const identity = (value: ProjectionEnvelope) => JSON.stringify([
    value.protocol, value.projectionId, value.serverOrigin, value.source.deviceId, value.source.sessionId,
    value.source.unitId, value.source.revision, value.content.kind, value.content.digest, value.expiresAtMs,
    value.nonce, value.signature.algorithm, value.signature.keyId, value.signature.value,
    ...(value.protocol === "neuro.qr-projection.v2" ? [value.source.accountId, value.source.publicKey] : []),
]);

export function validateLinkedResponse(link: QrProjectionLink, response: ProjectionResponse): void {
    // The native reader checks the requested ID/origin; recovery also binds the saved source identity.
    if (identity(response.envelope) !== identity(link.envelope) || response.revision < link.revision
        || (response.revision === link.revision && response.digest !== link.digest)
        || (link.role === "receiver" && (!response.linked || response.receiverUnitId !== link.localUnitId))) {
        throw new Error("projection_invalid_response");
    }
}

export function createProjectionSync(deps: ProjectionSyncDependencies) {
    const jobs = new Map<string, Work>();
    const now = deps.now ?? Date.now;
    let disposed = false;
    let inFlight = 0;
    let workspace = deps.generation();
    const frames = createProjectionFrameCache(deps.render);
    const stopListening = deps.onUnitRemoved((unitId) => {
        frames.remove(unitId);
        for (const [key, job] of jobs) if (job.unitId === unitId) { jobs.delete(key); deps.status(key, undefined); }
    });
    const getLink = (job: Work) => {
        const unit = deps.units().find((unit) => unit.id === job.unitId);
        return unit && projectionAssociations(unit).find((entry) => entry.key === job.key)?.link;
    };
    const current = (unitId: string, job: Work, stopping: boolean) => {
        const link = getLink(job);
        return !disposed && deps.generation() === job.generation && jobs.get(job.statusKey) === job
            && link?.envelope.projectionId === job.id && link.localUnitId === unitId && !link.stopped
            && Boolean(link.stopPending) === stopping;
    };

    const synchronize = async (unit: Unit, job: Work, link: QrProjectionLink) => {
        const stopping = Boolean(link.stopPending);
        const valid = () => current(unit.id, job, stopping);
        const status = (value: ProjectionSyncStatus) => deps.status(job.statusKey, value);
        const patch = (value: QrProjectionLink | undefined, image?: string) => job.key === undefined
            ? deps.patch(unit.id, value, ...(image ? [image] as const : []))
            : deps.patch(unit.id, value, image, job.key);
        try {
            if (stopping) {
                status({ phase: "stopping" });
                await deps.unlink(job.id, link.envelope.serverOrigin, link.envelope.protocol, ...(link.offlineTransport ? [link.offlineTransport] as const : []));
                if (valid()) {
                    patch(undefined);
                    status({ phase: "stopped" });
                }
                return;
            }
            let response = await deps.request({ kind: "read", projectionId: job.id, knownRevision: link.revision }, link.envelope.serverOrigin, link.envelope.protocol, ...(link.offlineTransport ? [link.offlineTransport] as const : []));
            if (!valid()) return;
            validateLinkedResponse(link, response);
            if (!response.linked) throw new Error("projection_unlinked");
            const editing = await deps.edit?.(unit.id, link, response, valid);
            if (!valid()) return;
            const nextLink = (): QrProjectionLink => ({
                ...link, revision: response.revision, digest: response.digest, linked: response.receiverDeviceId !== null,
            });
            if (editing) {
                job.signature = undefined;
            } else if (link.role === "receiver") {
                if (response.revision > link.revision) {
                    if (!response.snapshot) throw new Error("projection_invalid_response");
                    patch(nextLink(), response.snapshot.imageBase64);
                }
            } else {
                const latest = deps.units().find((item) => item.id === unit.id)!;
                const signature = deps.signature(latest);
                if (signature !== job.signature) {
                    status({ phase: "syncing" });
                    const frame = await frames.get(latest, signature);
                    if (!valid()) return;
                    const afterRender = deps.units().find((item) => item.id === unit.id)!;
                    if (deps.signature(afterRender) !== signature) return;
                    if (frame.digest !== response.digest) {
                        response = await deps.request({ kind: "update", projectionId: job.id,
                            sourceSessionId: link.envelope.source.sessionId, priorRevision: response.revision,
                            revision: response.revision + 1, snapshot: frame.snapshot }, link.envelope.serverOrigin, link.envelope.protocol, ...(link.offlineTransport ? [link.offlineTransport] as const : []));
                        if (!valid()) return;
                        validateLinkedResponse(link, response);
                        if (response.digest !== frame.digest) throw new Error("projection_invalid_response");
                    }
                    job.signature = signature;
                }
                const updated = nextLink();
                if (updated.revision !== link.revision || updated.digest !== link.digest || updated.linked !== link.linked) {
                    patch(updated);
                }
            }
            job.failures = 0;
            status({ phase: response.receiverDeviceId === null ? "waiting"
                : response.transport === "offline" || response.transport === "reconnecting" ? "retrying" : "connected",
                transport: response.transport, error: response.error, delivery: response.delivery });
        } catch (error) {
            if (!valid()) return;
            const code = errorCode(error);
            if (terminalErrors.has(code) || (stopping && code === "projection_account_mismatch")) {
                patch(stopping ? undefined : { ...link, stopped: true, stopReason: code });
                status({ phase: "stopped", error: code });
            } else {
                job.failures = Math.min(job.failures + 1, 6);
                status({ phase: stopping ? "stopping" : "retrying", error: code });
            }
        } finally {
            job.nextAt = now() + (job.failures ? Math.min(30_000, 500 * 2 ** job.failures) : 750);
            job.busy = false;
            inFlight -= 1;
        }
    };

    const tick = () => {
        if (disposed) return;
        const units = deps.units();
        const generation = deps.generation();
        if (workspace !== generation) { frames.clear(); workspace = generation; }
        for (const [key, job] of jobs) {
            const link = getLink(job);
            if (job.generation !== generation || link?.envelope.projectionId !== job.id || link.localUnitId !== job.unitId || link.stopped) {
                jobs.delete(key);
                deps.status(key, undefined);
            }
        }
        const due: { unit: Unit; job: Work; link: QrProjectionLink }[] = [];
        for (const unit of units) {
          for (const { key, link } of projectionAssociations(unit)) {
            if (!link || link.stopped || link.localUnitId !== unit.id || (link.role === "source" && link.envelope.source.unitId !== unit.id)) continue;
            const statusKey = key === undefined ? unit.id : projectionBindingStatusKey(unit.id, key);
            let job = jobs.get(statusKey);
            if (!job && jobs.size < 64) {
                job = { id: link.envelope.projectionId, unitId: unit.id, key, statusKey, generation, busy: false, failures: 0, nextAt: 0 };
                jobs.set(statusKey, job);
            }
            if (job && !job.busy && job.nextAt <= now()) due.push({ unit, job, link: { ...link } });
          }
        }
        // Oldest due work wins, so a source with expensive rendering cannot starve receivers.
        due.sort((a, b) => a.job.nextAt - b.job.nextAt);
        for (const { unit, job, link } of due) {
            if (inFlight >= 2) break;
            job.busy = true;
            inFlight += 1;
            void synchronize(unit, job, link);
        }
    };
    const timer = setInterval(tick, 500);
    tick();
    return {
        tick,
        retry(unitId: string) { for (const job of jobs.values()) if (job.unitId === unitId || job.statusKey === unitId) { job.nextAt = 0; job.failures = 0; } tick(); },
        dispose() { disposed = true; clearInterval(timer); stopListening(); jobs.clear(); frames.clear(); },
    };
}
