import type { DeliveryTarget } from "./projectionDeliveryApi";
import type { ProjectionFrame } from "./qrProjectionSnapshot";
import type { Unit } from "../types/unit";
import { prepareProjectionCreate, requestProjection } from "./qrProjectionApi";
import { cancelPreparedCreate, loadPreparedCreate, preparedCreateKey, savePreparedCreate } from "./projectionCreateJournal";
import { validateLinkedResponse } from "./qrProjectionSync";
import { queueProjectionUnlink } from "./qrProjectionCleanup";

const inFlight = new Map<string, Promise<unknown>>();
export async function createProjectionWithRecovery(origin: string, source: Unit, target: DeliveryTarget, frame: ProjectionFrame, current: () => boolean) {
    const peer = target.route === "offline_peer" ? { peerId: target.peerId, remoteDeviceId: target.remoteDeviceId } : undefined;
    const key = preparedCreateKey(origin, source.id, target.deviceId, peer);
    if (!inFlight.has(key) && inFlight.size >= 64) throw new Error("projection_create_journal_full");
    const previous = inFlight.get(key);
    const work = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => create(origin, source, target, frame, current));
    inFlight.set(key, work);
    try { return await work; }
    finally { if (inFlight.get(key) === work) inFlight.delete(key); }
}

async function create(origin: string, source: Unit, target: DeliveryTarget, frame: ProjectionFrame, current: () => boolean) {
    const peer = target.route === "offline_peer" ? { peerId: target.peerId, remoteDeviceId: target.remoteDeviceId } : undefined;
    const key = preparedCreateKey(origin, source.id, target.deviceId, peer);
    let saved = await loadPreparedCreate(key);
    if (!current()) throw new Error("projection_workspace_changed");
    if (!saved) {
        const envelope = await prepareProjectionCreate({ kind: "prepare_create", unitId: source.id,
            contentKind: source.type, snapshot: frame.snapshot, targetDeviceId: target.deviceId }, origin);
        if (!current()) throw new Error("projection_workspace_changed");
        saved = await savePreparedCreate({ key, origin, unitId: source.id, targetDeviceId: target.deviceId,
            ...(peer ? { target: peer } : {}), envelope, snapshot: frame.snapshot });
    }
    if (saved.cancelled) throw new Error("projection_create_cancelled");
    const record = saved;
    const transport = peer ? { origin } : undefined;
    const read = async () => {
        const response = await requestProjection({ kind: "read", projectionId: record.envelope.projectionId, knownRevision: 0 }, origin,
            "neuro.qr-projection.v1", transport);
        validateLinkedResponse({ role: "source", localUnitId: source.id, envelope: record.envelope,
            revision: record.envelope.source.revision, digest: record.envelope.content.digest, linked: false }, response);
        if (!response.linked || response.delivery?.targetDeviceId !== target.deviceId) throw new Error("projection_invalid_response");
        return response;
    };
    const execute = async () => {
        if (!current()) throw new Error("projection_workspace_changed");
        try { return await read(); }
        catch (error) { if (!(error instanceof Error) || error.message !== "projection_not_found") throw error; }
        if (!current()) throw new Error("projection_workspace_changed");
        try {
            return await requestProjection({ kind: "create_prepared", envelope: record.envelope, snapshot: record.snapshot,
                targetDeviceId: record.targetDeviceId }, origin, "neuro.qr-projection.v1", transport, record.target);
        } catch (error) {
            // A reply may be lost after commit. Reconcile the same signed identity.
            try { return await read(); } catch { throw error; }
        }
    };
    return execute().finally(async () => {
        if (!current()) {
            await cancelPreparedCreate(key);
            queueProjectionUnlink(record.envelope, transport);
        }
    });
}
