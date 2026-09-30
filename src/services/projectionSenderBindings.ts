import type { Unit } from "../types/unit";
import type { QrProjectionLink } from "../types/qrProjection";
import { projectionOrigin, sanitizeProjectionLink } from "./qrProjectionProtocol";

export const MAX_PROJECTION_SENDERS = 8;
export interface ProjectionSenderBinding {
    link: QrProjectionLink;
    target: { deviceId: string; peerId?: string; name: string };
}
export const projectionBindingKey = (link: QrProjectionLink): string => JSON.stringify([
    link.envelope.protocol, link.offlineTransport?.origin ?? link.envelope.serverOrigin,
    link.envelope.serverOrigin, link.envelope.projectionId,
]);
export const projectionTargetKey = (origin: string, target: ProjectionSenderBinding["target"]): string =>
    JSON.stringify([projectionOrigin(origin), target.peerId ?? "", target.deviceId]);
export const projectionBindingStatusKey = (unitId: string, key: string): string => JSON.stringify([unitId, key]);

export function sanitizeProjectionSenders(value: unknown, unitId: string): ProjectionSenderBinding[] | undefined {
    if (!Array.isArray(value) || value.length > MAX_PROJECTION_SENDERS) return undefined;
    const ids = new Set<string>();
    const targets = new Set<string>();
    const bindings: ProjectionSenderBinding[] = [];
    for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        const link = sanitizeProjectionLink(entry.link, unitId);
        const target: unknown = entry.target;
        if (!link || link.role !== "source" || link.envelope.protocol !== "neuro.qr-projection.v1"
            || !target || typeof target !== "object" || !("deviceId" in target) || !("name" in target)
            || typeof target.deviceId !== "string" || !/^[A-Za-z0-9._:/-]{1,160}$/.test(target.deviceId)
            || typeof target.name !== "string" || target.name.length > 1024) continue;
        const peerId = "peerId" in target ? target.peerId : undefined;
        if (peerId !== undefined && (typeof peerId !== "string" || !/^loom-[a-f0-9]{64}$/.test(peerId))) continue;
        if (!!peerId !== !!link.offlineTransport) continue;
        const clean = { deviceId: target.deviceId, name: target.name, ...(typeof peerId === "string" ? { peerId } : {}) };
        const id = projectionBindingKey(link);
        const targetId = projectionTargetKey(link.offlineTransport?.origin ?? link.envelope.serverOrigin, clean);
        if (ids.has(id) || targets.has(targetId)) continue;
        ids.add(id); targets.add(targetId); bindings.push({ link, target: clean });
    }
    return bindings.length ? bindings : undefined;
}

export function projectionAssociations(unit: Unit): { key?: string; link: QrProjectionLink }[] {
    const primary = unit.data.qrProjection;
    const result: { key?: string; link: QrProjectionLink }[] = primary ? [{ link: primary }] : [];
    const seen = new Set(primary ? [projectionBindingKey(primary)] : []);
    for (const { link } of (unit.data.projectionSenders ?? []).slice(0, MAX_PROJECTION_SENDERS)) {
        const key = projectionBindingKey(link);
        if (link.role !== "source" || seen.has(key)) continue;
        seen.add(key); result.push({ key, link });
    }
    return result.filter(({ link }) => link.localUnitId === unit.id
        && (link.role === "receiver" || link.envelope.source.unitId === unit.id));
}
