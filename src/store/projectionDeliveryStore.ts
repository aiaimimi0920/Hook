import { createSignal } from "solid-js";
import type { DeliveryInvitation, ReceivePolicy } from "../services/projectionDeliveryApi";
import { projectionOrigin } from "../services/qrProjectionProtocol";
import { projectionWorkspaceGeneration } from "../services/qrProjectionLifecycle";

export interface DeliverySettings { origin: string; policy: ReceivePolicy }
const key = "hook.projection-receiver.v1";
function load(): DeliverySettings {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
        if (value && typeof value === "object" && "origin" in value && typeof value.origin === "string"
            && "policy" in value && (value.policy === "auto" || value.policy === "confirm")) {
            return { origin: projectionOrigin(value.origin), policy: value.policy };
        }
    } catch { /* Invalid saved configuration never enables network access. */ }
    return { origin: "", policy: "disabled" };
}
export const [deliverySettings, setDeliverySettings] = createSignal<DeliverySettings>(load());
const [deliveryPending, updateDeliveryPending] = createSignal<DeliveryInvitation[]>([]);
export { deliveryPending };
let pendingGeneration = projectionWorkspaceGeneration();
export const deliveryPendingGeneration = () => pendingGeneration;
export function setDeliveryPending(value: DeliveryInvitation[] | ((items: DeliveryInvitation[]) => DeliveryInvitation[])): DeliveryInvitation[] {
    pendingGeneration = projectionWorkspaceGeneration();
    return updateDeliveryPending(value);
}
export const [deliveryError, setDeliveryError] = createSignal("");
export const [deliveryBusy, setDeliveryBusy] = createSignal(false);
export function saveDeliverySettings(origin: string, policy: ReceivePolicy): void {
    const value = { origin: projectionOrigin(origin.trim()), policy };
    localStorage.setItem(key, JSON.stringify(value));
    setDeliverySettings(value); setDeliveryPending([]); setDeliveryError("");
}
