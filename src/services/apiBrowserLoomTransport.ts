// Browser preview has no trusted native discovery or TLS exporter; never contact real Loom.
import type { HandshakeResponse } from "./protocol";
import { hookSurfaceHostCapabilities } from "./surfaceHostCapabilities";

export const NATIVE_LOOM_REQUIRED = "Loom integration requires the authenticated native desktop runtime";

export const browserLoomHookRequest = async <T = unknown>(
    _request: { method: string; params?: unknown },
    _options?: { timeoutMs?: number },
): Promise<T> => {
    throw new Error(NATIVE_LOOM_REQUIRED);
};

export const loomHookRequest = async <T = unknown>(_method: string, _params?: unknown): Promise<T> => {
    throw new Error(NATIVE_LOOM_REQUIRED);
};

export const browserHandshakeFallback = async (): Promise<HandshakeResponse> => ({
    protocolVersion: "loom.hook.v1",
    serverName: "browser-preview",
    serverVersion: "0.1.7",
    capabilities: {
        artDefinitions: [],
        surface: hookSurfaceHostCapabilities(),
        operations: [],
    },
    transport: "websocket",
    sessionId: "browser-preview",
});

/** Preserve disposer ownership for the local preview without networking or retry timers. */
export const listenBrowserLoomHookMethod = (
    _method: string,
    _handler: (payload: unknown) => void,
): (() => void) => () => undefined;
