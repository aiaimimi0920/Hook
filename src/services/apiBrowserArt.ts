// Native-only Art execution fails closed in the standalone browser preview.
import type { ArtDelivery } from "./protocol";
import { NATIVE_LOOM_REQUIRED } from "./apiBrowserLoomTransport";
import { warnBrowserFallback } from "./apiTransport";

export const browserDispatchActionFallback = async (
    actionEnum: { action: string; payload: unknown },
): Promise<void> => {
    if (actionEnum.action !== "execute_art") {
        warnBrowserFallback("dispatch:loom-native-only");
        return;
    }
    const payload = actionEnum.payload && typeof actionEnum.payload === "object"
        ? actionEnum.payload as Record<string, unknown>
        : {};
    // Terminate the local pending request, but never prepare/upload images or invent a success.
    if (typeof payload.node_id === "string" && typeof payload.request_id === "string") {
        window.dispatchEvent(new CustomEvent("hook-browser-art-ready", {
            detail: {
                art_id: payload.node_id,
                request_id: payload.request_id,
                status: 500,
                error: NATIVE_LOOM_REQUIRED,
                delivery: { type: "base64" },
            } satisfies ArtDelivery,
        }));
    }
};
