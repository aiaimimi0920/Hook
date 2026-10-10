// Credentials stay in memory and are never put in URLs, logs, or shared browser storage.
import { invoke, isTauri } from "@tauri-apps/api/core";

let previewToken: string | null = null;

const nativeProtocols = async (endpoint: string): Promise<string[]> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            invoke<string[]>("loom_hook_websocket_protocols", { endpoint }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error("Local Loom authentication timed out")), 5000);
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
};

/** Explicit opt-in for an operator-owned localhost:1420 development preview. */
export const setBrowserLoomToken = (token: string | null): void => {
    if (token !== null && (!token || token.length > 4096 || /\s/u.test(token)
        || Array.from(token).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))) {
        throw new Error("Invalid local Loom credential");
    }
    previewToken = token;
};

export const validateHookSocketEndpoint = (endpoint: string): void => {
    const url = new URL(endpoint);
    if (url.protocol !== "ws:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Hook WebSocket requires a credential-free loopback endpoint");
    }
};

export const createAuthenticatedHookWebSocket = async (endpoint: string): Promise<WebSocket> => {
    validateHookSocketEndpoint(endpoint);
    let protocols: string[];
    if (isTauri()) {
        protocols = await nativeProtocols(endpoint);
    } else {
        if (!previewToken) throw new Error("Local Loom authentication is required");
        const bytes = new TextEncoder().encode(previewToken);
        const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
            .replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
        protocols = ["loom.hook.v1", `loom.auth.${encoded}`];
    }
    return new WebSocket(endpoint, protocols);
};
