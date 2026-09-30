import { graphStore } from "../store/graphStore";
import { deliveryBusy, deliveryPendingGeneration, deliverySettings, setDeliveryBusy, setDeliveryError, setDeliveryPending } from "../store/projectionDeliveryStore";
import { deliveryInbox, deliveryReceipt, type DeliveryInvitation } from "./projectionDeliveryApi";
import { requestProjection } from "./qrProjectionApi";
import { attachProjectionReceiver } from "./qrProjectionSession";
import { onProjectionUnitRemoved, projectionWorkspaceGeneration } from "./qrProjectionLifecycle";
import { queueProjectionUnlink } from "./qrProjectionCleanup";
import { syncService } from "./syncService";

const unitId = (invitation: DeliveryInvitation) => "delivery-" + invitation.envelope.projectionId.slice("projection:".length);
let receiverLifetime = 0;
const queueDeliveryUnlink = (invitation: DeliveryInvitation) => queueProjectionUnlink(invitation.envelope, ...(invitation.offlineTransport ? [invitation.offlineTransport] as const : [] as const));

export async function receiveDelivery(invitation: DeliveryInvitation, active: () => boolean): Promise<void> {
    const id = unitId(invitation);
    let removed = false;
    const lifetime = receiverLifetime;
    const stopListening = onProjectionUnitRemoved((removedId) => { if (removedId === id) removed = true; });
    const valid = () => active() && !removed && receiverLifetime === lifetime;
    try {
        const previous = graphStore.units.find((unit) => unit.id === id);
        if (previous && (previous.data.qrProjection?.envelope.projectionId !== invitation.envelope.projectionId
            || previous.data.qrProjection.envelope.serverOrigin !== invitation.envelope.serverOrigin)) throw new Error("projection_invalid_response");
        if (previous?.data.qrProjection?.stopped || previous?.data.qrProjection?.stopPending) {
            queueDeliveryUnlink(invitation); return;
        }
        if (!previous) {
            const operation = { kind: "accept" as const, envelope: invitation.envelope,
                expectedRevision: invitation.revision, expectedDigest: invitation.digest, receiverUnitId: id, confirmed: true as const };
            const response = invitation.offlineTransport
                ? await requestProjection(operation, undefined, undefined, invitation.offlineTransport)
                : await requestProjection(operation);
            if (!valid()) { queueDeliveryUnlink(invitation); return; }
            // A deterministic unit ID lets a lost acceptance response recover without duplicate stickers.
            attachProjectionReceiver(id, response);
        }
        await syncService.persistPendingChanges();
        if (!valid()) { queueDeliveryUnlink(invitation); return; }
        // Report rendered pixels, never just the server's successful acceptance response.
        const deadline = Date.now() + 3000;
        while (valid() && Date.now() < deadline) {
            const image = document.querySelector<HTMLImageElement>('[data-unit-id="' + id + '"] [data-sticker-base-image]');
            const unit = graphStore.units.find((item) => item.id === id);
            const rect = image?.getBoundingClientRect();
            const style = image && getComputedStyle(image);
            if (unit && image?.complete && image.naturalWidth > 0 && image.src === unit.data.src
                && rect && rect.width > 0 && rect.height > 0 && style?.visibility !== "hidden" && style?.display !== "none"
                && (typeof image.checkVisibility !== "function" || image.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
                && Number(style?.opacity ?? 1) > 0 && valid()) {
                await deliveryReceipt(invitation.envelope.serverOrigin, invitation.envelope.projectionId, "displayed", ...(invitation.offlineTransport ? [invitation.offlineTransport] as const : [] as const));
                return;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
        if (!valid()) queueDeliveryUnlink(invitation);
        else throw new Error("projection_display_pending");
    } finally {
        if (!valid()) queueDeliveryUnlink(invitation);
        stopListening();
    }
}

export async function decideDelivery(invitation: DeliveryInvitation, accept: boolean): Promise<void> {
    if (deliveryBusy()) return;
    const settings = deliverySettings();
    const generation = projectionWorkspaceGeneration();
    // The visible inbox may still belong to the previous workspace until the next poll.
    if (deliveryPendingGeneration() !== generation) {
        setDeliveryPending([]); setDeliveryError("projection_workspace_changed"); return;
    }
    const valid = () => settings === deliverySettings() && generation === projectionWorkspaceGeneration();
    setDeliveryBusy(true); setDeliveryError("");
    try {
        if (settings.policy === "disabled" || settings.origin !== (invitation.offlineTransport?.origin ?? invitation.envelope.serverOrigin)) return;
        if (accept) await receiveDelivery(invitation, valid);
        else await deliveryReceipt(settings.origin, invitation.envelope.projectionId, "rejected", ...(invitation.offlineTransport ? [invitation.offlineTransport] as const : [] as const));
        if (valid()) setDeliveryPending((items) => items.filter((item) => item.envelope.projectionId !== invitation.envelope.projectionId));
    } catch (reason) { if (valid()) setDeliveryError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeliveryBusy(false); }
}

export function createDeliveryReceiver() {
    let disposed = false;
    let polling = false;
    let nextAt = 0;
    let failures = 0;
    let lastAttempt = "";
    let lastSettings = deliverySettings();
    let generation = projectionWorkspaceGeneration();
    const tick = async () => {
        const settings = deliverySettings();
        if (settings !== lastSettings) { lastSettings = settings; generation = projectionWorkspaceGeneration(); nextAt = 0; }
        if (disposed || polling || deliveryBusy() || settings.policy === "disabled" || Date.now() < nextAt) return;
        if (generation !== projectionWorkspaceGeneration()) {
            setDeliveryPending([]); setDeliveryError("projection_workspace_changed"); return;
        }
        const valid = () => !disposed && settings === deliverySettings() && generation === projectionWorkspaceGeneration();
        polling = true;
        try {
            const items = await deliveryInbox(settings.origin, settings.policy);
            if (!valid()) return;
            setDeliveryPending(items); setDeliveryError(""); failures = 0;
            const candidates = items.filter((item) => item.accepted || (item.receivePolicy ?? settings.policy) === "auto");
            const automatic = candidates[(candidates.findIndex((item) => item.envelope.projectionId === lastAttempt) + 1) % candidates.length];
            if (automatic) {
                lastAttempt = automatic.envelope.projectionId;
                setDeliveryBusy(true);
                try { await receiveDelivery(automatic, valid); }
                finally { setDeliveryBusy(false); }
            }
        } catch (reason) {
            if (valid()) { failures = Math.min(failures + 1, 4); setDeliveryError(reason instanceof Error ? reason.message : String(reason)); }
        } finally { polling = false; nextAt = Date.now() + Math.min(30_000, 3000 * 2 ** failures); }
    };
    const timer = setInterval(() => void tick(), 1000);
    void tick();
    return { dispose() { disposed = true; receiverLifetime += 1; clearInterval(timer); } };
}
