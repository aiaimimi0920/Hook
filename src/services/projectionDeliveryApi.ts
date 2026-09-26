import { safeInvoke } from "./apiTransport";
import { parseProjectionEnvelope, projectionOrigin } from "./qrProjectionProtocol";
import type { OfflineProjectionTransport, ProjectionEnvelope } from "../types/qrProjection";

export type ReceivePolicy = "disabled" | "confirm" | "auto";
type TargetBase = { deviceId: string; name: string; policy: "confirm" | "auto" };
export type DeliveryTarget = TargetBase & ({ route: "shared_loom" } | {
    route: "offline_peer"; peerId: string; peerName: string; remoteDeviceId: string; deliveryAvailable: boolean;
});
export type DirectoryStatus = "complete" | "partial" | "busy" | "unavailable";
export interface DeliveryDirectory { targets: DeliveryTarget[]; status: DirectoryStatus }
export interface DeliveryInvitation { envelope: ProjectionEnvelope; revision: number; digest: string; sourceName: string; accepted: boolean; offlineTransport?: OfflineProjectionTransport }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("projection_invalid_response");
const request = (origin: string, operation: Record<string, unknown>, offline = false) =>
    safeInvoke<unknown>("projection_request", { operation, serverOrigin: projectionOrigin(origin), ...(offline ? { offlineRoute: {} } : {}) });

export async function deliveryTargets(origin: string): Promise<DeliveryDirectory> {
    const value = await request(origin, { kind: "targets" });
    if (!object(value) || !Array.isArray(value.targets) || value.targets.length > 64) throw invalid();
    const status = value.peerDirectory === undefined ? "complete" : object(value.peerDirectory) ? value.peerDirectory.status : undefined;
    if (status !== "complete" && status !== "partial" && status !== "busy" && status !== "unavailable") throw invalid();
    const targets = value.targets.map((entry: unknown): DeliveryTarget => {
        if (!object(entry) || typeof entry.deviceId !== "string" || typeof entry.name !== "string"
            || entry.deviceId.length > 160 || entry.name.length > 1024
            || (entry.policy !== "confirm" && entry.policy !== "auto")) throw invalid();
        const base: TargetBase = { deviceId: entry.deviceId, name: entry.name, policy: entry.policy };
        if (entry.route === "shared_loom" && !entry.deviceId.startsWith("peer-target:") && entry.peerId === undefined) return { ...base, route: "shared_loom" };
        if (entry.route !== "offline_peer" || !/^peer-target:[a-f0-9]{64}$/.test(entry.deviceId)
            || typeof entry.peerId !== "string" || !/^loom-[a-f0-9]{64}$/.test(entry.peerId)
            || typeof entry.remoteDeviceId !== "string" || entry.remoteDeviceId.length > 160
            || typeof entry.peerName !== "string" || !entry.peerName || entry.peerName.length > 128
            || typeof entry.deliveryAvailable !== "boolean"
            || (entry.deliveryAvailable ? entry.transferProtocol !== "loom.offline-transfer.v1" : entry.unavailableReason !== "offline_peer_delivery_not_implemented")) throw invalid();
        return { ...base, route: "offline_peer", peerId: entry.peerId, peerName: entry.peerName,
            remoteDeviceId: entry.remoteDeviceId, deliveryAvailable: entry.deliveryAvailable };
    });
    return { targets, status };
}

export async function deliveryInbox(origin: string, policy: ReceivePolicy): Promise<DeliveryInvitation[]> {
    const value = await request(origin, { kind: "inbox", policy });
    const local = parseInbox(value, origin, false);
    if (!object(value) || value.offlinePeers !== true || policy === "disabled") return local;
    return [...local, ...parseInbox(await request(origin, { kind: "inbox", policy }, true), origin, true)].slice(0, 64);
}

function parseInbox(value: unknown, origin: string, offline: boolean): DeliveryInvitation[] {
    if (!object(value) || !Array.isArray(value.invitations) || value.invitations.length > 64) throw invalid();
    return value.invitations.map((entry: unknown) => {
        if (!object(entry) || !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 1
            || typeof entry.digest !== "string" || !/^[a-f0-9]{64}$/.test(entry.digest)
            || !object(entry.delivery) || !["awaiting_confirmation", "accepted"].includes(String(entry.delivery.status))) throw invalid();
        const envelope = parseProjectionEnvelope(entry.envelope);
        if (envelope.protocol !== "neuro.qr-projection.v1" || (offline ? entry.route !== "offline_peer" : envelope.serverOrigin !== projectionOrigin(origin))) throw invalid();
        return { envelope, revision: Number(entry.revision), digest: entry.digest,
            sourceName: typeof entry.sourceName === "string" ? entry.sourceName : envelope.source.deviceId,
            accepted: entry.delivery.status === "accepted", ...(offline ? { offlineTransport: { origin: projectionOrigin(origin) } } : {}) };
    });
}

export async function deliveryReceipt(origin: string, projectionId: string, status: "displayed" | "rejected", offlineTransport?: OfflineProjectionTransport): Promise<void> {
    const value = await request(offlineTransport?.origin ?? origin, { kind: "receipt", projectionId, status }, !!offlineTransport);
    if (!object(value) || value.recorded !== true) throw invalid();
}
