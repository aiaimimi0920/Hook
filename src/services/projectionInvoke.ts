import { safeInvoke } from "./apiTransport";

export async function projectionInvoke(command: "projection_request" | "projection_v2_request", args: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await safeInvoke<unknown>(command, args);
        } catch (reason) {
            const error = reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "projection_network_error");
            // Native busy rejects before execution. Never replay a transport failure: creation may already have succeeded.
            if (error.message !== "projection_busy" || attempt >= 60) throw error;
            await new Promise<void>((resolve) => setTimeout(resolve, 250));
        }
    }
}
