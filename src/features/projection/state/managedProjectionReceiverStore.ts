import { createSignal } from "solid-js";
import { deliverySettings, setDeliveryError, setDeliveryPending, setDeliverySettings } from "./projectionDeliveryStore";

const key = "hook.projection-receiver.managed.v1";
function loadPaused(): boolean {
    try {
        const current: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
        if (current && typeof current === "object" && "paused" in current && typeof current.paused === "boolean") return current.paused;
        const previous: unknown = JSON.parse(localStorage.getItem("hook.projection-receiver.v1") ?? "null");
        return !!previous && typeof previous === "object" && "policy" in previous && previous.policy === "disabled";
    } catch { return true; }
}
export const [projectionReceiverPaused, updatePaused] = createSignal(loadPaused());
export function pauseProjectionReceiver(paused: boolean): void {
    localStorage.setItem(key, JSON.stringify({ paused }));
    updatePaused(paused);
    if (paused) {
        setDeliverySettings({ ...deliverySettings(), policy: "disabled" });
        setDeliveryPending([]); setDeliveryError("");
    }
}
