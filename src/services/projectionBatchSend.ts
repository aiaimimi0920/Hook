import type { Unit } from "../types/unit";
import type { DeliveryTarget } from "./projectionDeliveryApi";
import { createProjectionWithRecovery } from "./projectionCreateRetry";
import { renderProjectionFrame } from "./qrProjectionSnapshot";
import { projectionEditing } from "./projectionEditSession";
import { projectionLinkFromResponse } from "./qrProjectionSession";
import { MAX_PROJECTION_SENDERS, projectionTargetKey, type ProjectionSenderBinding } from "./projectionSenderBindings";

export const deliveryTargetIdentity = (target: DeliveryTarget): ProjectionSenderBinding["target"] => ({
    deviceId: target.route === "offline_peer" ? target.remoteDeviceId : target.deviceId,
    name: target.name, ...(target.route === "offline_peer" ? { peerId: target.peerId } : {}),
});
export interface ProjectionBatchResult { target: DeliveryTarget; error?: string; created: boolean }
export interface ProjectionBatchOwner {
    current: () => Unit | undefined;
    save: (bindings: ProjectionSenderBinding[]) => void;
    result: (result: ProjectionBatchResult) => void;
}

export async function sendProjectionBatch(origin: string, targets: DeliveryTarget[], owner: ProjectionBatchOwner): Promise<void> {
    const source = owner.current();
    if (!source || source.data.qrProjection?.role === "receiver") throw new Error("projection_source_unavailable");
    const key = (target: ProjectionSenderBinding["target"]) => projectionTargetKey(origin, target);
    const exists = (target: DeliveryTarget) => (owner.current()?.data.projectionSenders ?? []).some((binding) =>
        projectionTargetKey(binding.link.offlineTransport?.origin ?? binding.link.envelope.serverOrigin, binding.target) === key(deliveryTargetIdentity(target)));
    const unique = [...new Map(targets.map((target) => [key(deliveryTargetIdentity(target)), target])).values()];
    const pending = unique.filter((target) => !exists(target));
    if (pending.length + (source.data.projectionSenders?.length ?? 0) + (source.data.qrProjection ? 1 : 0) > MAX_PROJECTION_SENDERS) {
        throw new Error("projection_source_limit");
    }
    for (const target of unique.filter(exists)) owner.result({ target, created: false });
    if (!pending.length) return;
    const frame = await projectionEditing.sendFrame(source.id, () => renderProjectionFrame(source), { origin, protocol: "neuro.qr-projection.v1" });
    let next = 0;
    const worker = async () => {
        while (next < pending.length && owner.current()) {
            const target = pending[next++];
            try {
                if (target.route === "offline_peer" && !target.deliveryAvailable) throw new Error("projection_target_unavailable");
                const response = await createProjectionWithRecovery(origin, source, target, frame, () => !!owner.current());
                const latest = owner.current();
                if (!latest) return; // The durable create owner queues late-result cleanup.
                const binding = { link: projectionLinkFromResponse("source", source.id, response), target: deliveryTargetIdentity(target) };
                owner.save([...(latest.data.projectionSenders ?? []), binding]);
                owner.result({ target, created: true });
            } catch (error) {
                if (owner.current()) owner.result({ target, created: false, error: error instanceof Error ? error.message : "projection_network_error" });
            }
        }
    };
    await Promise.all([worker(), worker()]);
}
