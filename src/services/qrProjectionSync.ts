import type { Unit } from "../types/unit";
import type { ProjectionEnvelope, ProjectionProtocol, ProjectionResponse, QrProjectionLink } from "../types/qrProjection";
import type { requestProjection } from "./qrProjectionApi";
import type { ProjectionFrame } from "./qrProjectionSnapshot";

export interface ProjectionSyncStatus {
    phase: "waiting" | "connected" | "syncing" | "retrying" | "stopping" | "stopped";
    error?: string;
    transport?: ProjectionResponse["transport"];
}
export interface ProjectionSyncDependencies {
    units: () => readonly Unit[];
    generation: () => number;
    onUnitRemoved: (listener: (unitId: string) => void) => () => void;
    signature: (unit: Unit) => string;
    render: (unit: Unit) => Promise<ProjectionFrame>;
    request: typeof requestProjection;
    unlink: (id: string, origin: string, protocol?: ProjectionProtocol) => Promise<void>;
    patch: (unitId: string, link: QrProjectionLink | undefined, imageBase64?: string) => void;
    status: (unitId: string, status: ProjectionSyncStatus | undefined) => void;
    now?: () => number;
}
interface Work {
    id: string;
    generation: number;
    busy: boolean;
    failures: number;
    nextAt: number;
    signature?: string;
}

const terminalErrors = new Set([
    "projection_unlinked", "projection_invitation_expired", "projection_source_revoked",
    "projection_access_denied", "projection_not_found", "projection_source_mismatch",
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
    const stopListening = deps.onUnitRemoved((unitId) => {
        if (jobs.delete(unitId)) deps.status(unitId, undefined);
    });
    const getLink = (unitId: string) => deps.units().find((unit) => unit.id === unitId)?.data.qrProjection;
    const current = (unitId: string, job: Work, stopping: boolean) => {
        const link = getLink(unitId);
        return !disposed && deps.generation() === job.generation && jobs.get(unitId) === job
            && link?.envelope.projectionId === job.id && link.localUnitId === unitId
            && Boolean(link.stopPending) === stopping;
    };

    const synchronize = async (unit: Unit, job: Work, link: QrProjectionLink) => {
        const stopping = Boolean(link.stopPending);
        const valid = () => current(unit.id, job, stopping);
        try {
            if (stopping) {
                deps.status(unit.id, { phase: "stopping" });
                await deps.unlink(job.id, link.envelope.serverOrigin, link.envelope.protocol);
                if (valid()) {
                    deps.patch(unit.id, undefined);
                    deps.status(unit.id, { phase: "stopped" });
                }
                return;
            }
            let response = await deps.request({ kind: "read", projectionId: job.id, knownRevision: link.revision }, link.envelope.serverOrigin, link.envelope.protocol);
            if (!valid()) return;
            validateLinkedResponse(link, response);
            if (!response.linked) throw new Error("projection_unlinked");
            const nextLink = (): QrProjectionLink => ({
                ...link, revision: response.revision, digest: response.digest, linked: response.receiverDeviceId !== null,
            });
            if (link.role === "receiver") {
                if (response.revision > link.revision) {
                    if (!response.snapshot) throw new Error("projection_invalid_response");
                    deps.patch(unit.id, nextLink(), response.snapshot.imageBase64);
                }
            } else {
                const latest = deps.units().find((item) => item.id === unit.id)!;
                const signature = deps.signature(latest);
                if (signature !== job.signature) {
                    deps.status(unit.id, { phase: "syncing" });
                    const frame = await deps.render(latest);
                    if (!valid()) return;
                    const afterRender = deps.units().find((item) => item.id === unit.id)!;
                    if (deps.signature(afterRender) !== signature) return;
                    if (frame.digest !== response.digest) {
                        response = await deps.request({ kind: "update", projectionId: job.id,
                            sourceSessionId: link.envelope.source.sessionId, priorRevision: response.revision,
                            revision: response.revision + 1, snapshot: frame.snapshot }, link.envelope.serverOrigin, link.envelope.protocol);
                        if (!valid()) return;
                        validateLinkedResponse(link, response);
                        if (response.digest !== frame.digest) throw new Error("projection_invalid_response");
                    }
                    job.signature = signature;
                }
                const updated = nextLink();
                if (updated.revision !== link.revision || updated.digest !== link.digest || updated.linked !== link.linked) {
                    deps.patch(unit.id, updated);
                }
            }
            job.failures = 0;
            deps.status(unit.id, { phase: response.receiverDeviceId === null ? "waiting"
                : response.transport === "offline" || response.transport === "reconnecting" ? "retrying" : "connected",
                transport: response.transport, error: response.error });
        } catch (error) {
            if (!valid()) return;
            const code = errorCode(error);
            if (terminalErrors.has(code) || (stopping && code === "projection_account_mismatch")) {
                deps.patch(unit.id, stopping ? undefined : { ...link, stopped: true, stopReason: code });
                deps.status(unit.id, { phase: "stopped", error: code });
            } else {
                job.failures = Math.min(job.failures + 1, 6);
                deps.status(unit.id, { phase: stopping ? "stopping" : "retrying", error: code });
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
        for (const [unitId, job] of jobs) {
            const link = getLink(unitId);
            if (job.generation !== generation || link?.envelope.projectionId !== job.id || link.localUnitId !== unitId || link.stopped) {
                jobs.delete(unitId);
                if (!link) deps.status(unitId, undefined);
            }
        }
        const due: { unit: Unit; job: Work; link: QrProjectionLink }[] = [];
        for (const unit of units) {
            const link = unit.data.qrProjection;
            if (!link || link.stopped || link.localUnitId !== unit.id || (link.role === "source" && link.envelope.source.unitId !== unit.id)) continue;
            let job = jobs.get(unit.id);
            if (!job && jobs.size < 64) {
                job = { id: link.envelope.projectionId, generation, busy: false, failures: 0, nextAt: 0 };
                jobs.set(unit.id, job);
            }
            if (job && !job.busy && job.nextAt <= now()) due.push({ unit, job, link: { ...link } });
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
        retry(unitId: string) { const job = jobs.get(unitId); if (job) { job.nextAt = 0; job.failures = 0; } tick(); },
        dispose() { disposed = true; clearInterval(timer); stopListening(); jobs.clear(); },
    };
}
