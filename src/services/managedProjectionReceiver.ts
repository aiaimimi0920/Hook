import { projectionContext } from "./qrProjectionApi";
import { projectionWorkspaceGeneration } from "./qrProjectionLifecycle";
import { deliverySettings, setDeliverySettings, setDeliveryPending, setDeliveryError } from "../store/projectionDeliveryStore";
import { projectionReceiverPaused } from "../store/managedProjectionReceiverStore";

// Connection configuration belongs to Loom; only a local participation pause is retained.
export function createManagedProjectionReceiver() {
    let disposed = false;
    let resolving = false;
    let nextAt = 0;
    let generation = -1;
    let paused = projectionReceiverPaused();
    const disable = () => {
        setDeliverySettings({ origin: "", policy: "disabled" }); setDeliveryPending([]);
    };
    disable();
    const tick = async () => {
        if (disposed || resolving) return;
        if (paused !== projectionReceiverPaused() || generation !== projectionWorkspaceGeneration()) nextAt = 0;
        paused = projectionReceiverPaused();
        if (paused || Date.now() < nextAt) return;
        resolving = true;
        const requestedGeneration = projectionWorkspaceGeneration();
        try {
            const origin = await projectionContext();
            if (disposed || projectionReceiverPaused() || requestedGeneration !== projectionWorkspaceGeneration()) return;
            if (deliverySettings().origin !== origin || deliverySettings().policy !== "confirm" || generation !== requestedGeneration) {
                setDeliverySettings({ origin, policy: "confirm" }); setDeliveryPending([]); setDeliveryError("");
            }
            generation = requestedGeneration;
        } catch (reason) {
            if (!disposed && !projectionReceiverPaused() && requestedGeneration === projectionWorkspaceGeneration()) {
                disable(); setDeliveryError(reason instanceof Error ? reason.message : String(reason));
                generation = requestedGeneration;
            }
        } finally { resolving = false; nextAt = Date.now() + 5000; }
    };
    const timer = setInterval(() => void tick(), 1000);
    void tick();
    return { dispose() { disposed = true; clearInterval(timer); disable(); } };
}
