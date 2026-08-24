// Owns browser Loom request sockets, push subscriptions, reconnect timers, and response error mapping.
import type { HandshakeResponse } from "./protocol";
import { hookSurfaceHostCapabilities } from "./surfaceHostCapabilities";

const createBrowserPreviewHandshake = (): HandshakeResponse => ({
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

const BROWSER_LOOM_HOOK_WS_URL = "ws://127.0.0.1:19820";
const BROWSER_WS_REQUEST_TIMEOUT_MS = 20000;
type BrowserPushHandler = (payload: unknown) => void;
const browserPushHandlers = new Map<string, Set<BrowserPushHandler>>();
let browserPushSocket: WebSocket | null = null;
let browserPushReconnectTimer: number | null = null;

const requestIdFromParams = (params: unknown): string | undefined => {
    if (!params || typeof params !== "object" || !("requestId" in params)) return undefined;
    return typeof params.requestId === "string" ? params.requestId : undefined;
};

export const browserLoomHookRequest = async <T = unknown>(
    request: { method: string; params?: unknown },
    options?: { timeoutMs?: number },
): Promise<T> => {
    if (typeof WebSocket === "undefined") {
        throw new Error("WebSocket unavailable in current browser environment");
    }

    const expectedRequestId = requestIdFromParams(request.params);
    const timeoutMs = options?.timeoutMs ?? BROWSER_WS_REQUEST_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
        const ws = new WebSocket(BROWSER_LOOM_HOOK_WS_URL);
        let settled = false;

        const timeout = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            ws.close();
            reject(new Error(`Loom Hook WebSocket request timed out: ${request.method}`));
        }, timeoutMs);

        ws.onerror = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            ws.close();
            reject(new Error(`Loom Hook WebSocket connection failed: ${request.method}`));
        };

        ws.onopen = () => {
            ws.send(JSON.stringify(request));
        };

        ws.onclose = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error(`Loom Hook WebSocket closed before response: ${request.method}`));
        };

        ws.onmessage = (event) => {
            try {
                const parsed = JSON.parse(String(event.data));
                if (!parsed || typeof parsed !== "object") {
                    return;
                }
                const isHandshake = request.method === "loom.hook.handshake" &&
                    parsed.protocolVersion === "loom.hook.v1" &&
                    typeof parsed.sessionId === "string" &&
                    typeof parsed.serverName === "string";
                const isRequestResponse = expectedRequestId !== undefined &&
                    parsed.protocolVersion === "loom.hook.v1" &&
                    parsed.requestId === expectedRequestId &&
                    typeof parsed.status === "string";
                const isHookResponse = isHandshake || isRequestResponse;
                if (!isHookResponse) {
                    return;
                }

                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                ws.close();
                resolve(parsed as T);
            } catch (error) {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                ws.close();
                reject(error);
            }
        };
    });
};

export const loomHookRequest = async <T = unknown>(method: string, params?: unknown): Promise<T> => {
    interface ErrorResponse {
        type?: string;
        data?: { message?: string } & T;
        message?: string;
    }

    const response = await browserLoomHookRequest<ErrorResponse>({
        method,
        params,
    });

    const responseRecord = response as ErrorResponse & { status?: string; error?: { message?: string } };
    if (response?.type === "error" || responseRecord.status === "failed") {
        const errorMessage =
            (response.data && typeof response.data === "object" && "message" in response.data
                ? response.data.message
                : undefined) ||
            response.message ||
            responseRecord.error?.message ||
            `Loom Hook IPC request failed: ${method}`;
        throw new Error(errorMessage);
    }

    return (response?.data ?? response) as T;
};

const scheduleBrowserPushReconnect = () => {
    if (browserPushReconnectTimer !== null || browserPushHandlers.size === 0) return;

    browserPushReconnectTimer = window.setTimeout(() => {
        browserPushReconnectTimer = null;
        ensureBrowserPushSocket();
    }, 1000);
};

const sendBrowserPushSubscription = () => {
    if (!browserPushSocket || browserPushSocket.readyState !== WebSocket.OPEN) return;

    try {
        const events = Array.from(browserPushHandlers.keys());
        browserPushSocket.send(JSON.stringify({
            method: "loom.hook.subscribe",
            params: {
                requestId: `subscribe:${crypto.randomUUID()}`,
                events,
            },
        }));
    } catch (error) {
        console.error("[API] Failed to subscribe browser push socket:", error);
    }
};

const ensureBrowserPushSocket = () => {
    if (typeof WebSocket === "undefined") return;
    if (browserPushSocket && browserPushSocket.readyState !== WebSocket.CLOSED) {
        sendBrowserPushSubscription();
        return;
    }
    if (browserPushHandlers.size === 0) return;

    browserPushSocket = new WebSocket(BROWSER_LOOM_HOOK_WS_URL);

    browserPushSocket.onopen = () => {
        sendBrowserPushSubscription();
    };

    browserPushSocket.onmessage = (event) => {
        try {
            const parsed = JSON.parse(String(event.data));
            if (parsed?.protocolVersion !== "loom.hook.v1") return;
            const method = typeof parsed?.method === "string" ? parsed.method : null;
            if (!method) return;

            const handlers = browserPushHandlers.get(method);
            if (!handlers || handlers.size === 0) return;

            handlers.forEach((handler) => {
                try {
                    handler(parsed.params);
                } catch (error) {
                    console.error(`[API] Browser push handler failed for ${method}:`, error);
                }
            });
        } catch (error) {
            console.error("[API] Failed to parse browser push message:", error);
        }
    };

    browserPushSocket.onclose = () => {
        browserPushSocket = null;
        scheduleBrowserPushReconnect();
    };

    browserPushSocket.onerror = () => {
        browserPushSocket?.close();
    };
};

const stopBrowserPushSocketIfUnused = () => {
    if (browserPushHandlers.size > 0) return;
    if (browserPushReconnectTimer !== null) {
        window.clearTimeout(browserPushReconnectTimer);
        browserPushReconnectTimer = null;
    }
    browserPushSocket?.close();
    browserPushSocket = null;
};

export const browserHandshakeFallback = async (): Promise<HandshakeResponse> => {
    try {
        return await browserLoomHookRequest<HandshakeResponse>({
            method: "loom.hook.handshake",
            params: {
                protocolVersion: "loom.hook.v1",
                supportedProtocolVersions: ["loom.hook.v1"],
                clientId: "hook.browser-preview",
                clientVersion: "0.1.7",
                platform: "browser-preview",
                transports: ["websocket"],
                surface: hookSurfaceHostCapabilities(),
            },
        });
    } catch (error) {
        console.warn("[API] browserLoom Hook handshake fallback failed:", error);
        return createBrowserPreviewHandshake();
    }
};

export const listenBrowserLoomHookMethod = (
    method: string,
    handler: BrowserPushHandler,
): (() => void) => {
    const handlers = browserPushHandlers.get(method) || new Set<BrowserPushHandler>();
    handlers.add(handler);
    browserPushHandlers.set(method, handlers);
    ensureBrowserPushSocket();

    return () => {
        const existing = browserPushHandlers.get(method);
        if (!existing) return;
        existing.delete(handler);
        if (existing.size === 0) {
            browserPushHandlers.delete(method);
        }
        if (browserPushHandlers.size === 0) {
            stopBrowserPushSocketIfUnused();
        } else {
            sendBrowserPushSubscription();
        }
    };
};
