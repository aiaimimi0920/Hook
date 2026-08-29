import { extensionRegistry } from "./extensionRegistry";
import {
    extensionProtocolIdentity,
    parseExtensionBridgeResponse,
    parseExtensionHandshakeData,
    parseExtensionResult,
    parseExtensionSnapshotEvent,
    type ExtensionResult,
    type ExtensionTarget,
} from "./extensionBridgeProtocol";

type PendingRequest = {
    resolve: (value: ExtensionResult) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};

type WebSocketFactory = (url: string) => WebSocket;

const requestId = (prefix: string): string => {
    const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}:${suffix}`;
};

/** Maintains one reconnecting extension session over a Hook-authenticated WebSocket. */
export class ExtensionBridgeClient {
    private socket: WebSocket | null = null;
    private stopped = true;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private extensionSessionId: string | null = null;
    private extensionHandshakeRequestId: string | null = null;
    private readonly pending = new Map<string, PendingRequest>();

    constructor(
        private readonly createWebSocket: WebSocketFactory = (url) => new WebSocket(url),
        private readonly endpoint = "ws://127.0.0.1:19820",
    ) {}

    start(): () => void {
        if (!this.stopped) return () => this.stop();
        this.stopped = false;
        this.connect();
        return () => this.stop();
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        const socket = this.socket;
        this.socket = null;
        socket?.close();
        this.disconnect(new Error("extension bridge stopped"));
    }

    diagnostics(): {
        running: boolean;
        connected: boolean;
        pendingRequests: number;
        reconnectTimers: number;
    } {
        return {
            running: !this.stopped,
            connected: this.socket?.readyState === 1 && this.extensionSessionId !== null,
            pendingRequests: this.pending.size,
            reconnectTimers: this.reconnectTimer ? 1 : 0,
        };
    }

    invoke(command: {
        pluginId: string;
        commandId: string;
        target: ExtensionTarget;
        input?: unknown;
        userGestureToken?: string;
    }): Promise<ExtensionResult> {
        const sessionId = this.extensionSessionId;
        const snapshot = extensionRegistry.snapshot();
        if (!sessionId || !snapshot || this.socket?.readyState !== 1) {
            return Promise.reject(new Error("extension bridge is disconnected"));
        }
        if (this.pending.size >= 128) return Promise.reject(new Error("extension bridge request limit reached"));
        const id = requestId("extension-command");
        const payload = {
            method: "loom.extension.command.invoke",
            params: {
                sessionId,
                invocation: {
                    ...extensionProtocolIdentity,
                    requestId: id,
                    pluginId: command.pluginId,
                    commandId: command.commandId,
                    snapshotGeneration: snapshot.generation,
                    target: command.target,
                    input: command.input ?? {},
                    resourceRefs: [],
                    ...(command.userGestureToken ? { userGestureToken: command.userGestureToken } : {}),
                },
            },
        };
        const socket = this.socket;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error("extension command timed out"));
            }, 20_000);
            this.pending.set(id, { resolve, reject, timeout });
            if (!socket || !this.send(socket, payload)) return;
        });
    }

    private connect(): void {
        if (this.stopped) return;
        let socket: WebSocket;
        try {
            socket = this.createWebSocket(this.endpoint);
        } catch {
            this.scheduleReconnect();
            return;
        }
        this.socket = socket;
        socket.onopen = () => {
            if (this.socket !== socket) return;
            this.send(socket, {
                method: "loom.hook.handshake",
                params: {
                    protocolVersion: "loom.hook.v1",
                    supportedProtocolVersions: ["loom.hook.v1"],
                    clientId: "hook.extension-host",
                    clientVersion: "0.2.0",
                    platform: "windows-x64",
                    transports: ["websocket"],
                },
            });
        };
        socket.onmessage = (event) => {
            if (this.socket === socket) this.handleMessage(socket, String(event.data));
        };
        socket.onerror = () => undefined;
        socket.onclose = () => {
            if (this.socket !== socket) return;
            this.socket = null;
            this.disconnect(new Error("extension bridge disconnected"));
            this.scheduleReconnect();
        };
    }

    private handleMessage(socket: WebSocket, text: string): void {
        let value: unknown;
        try {
            value = JSON.parse(text);
        } catch {
            return;
        }
        let eventSnapshot: unknown | null = null;
        try {
            eventSnapshot = parseExtensionSnapshotEvent(value);
        } catch (error) {
            this.failSocket(socket, error);
            return;
        }
        if (eventSnapshot !== null && this.extensionSessionId) {
            const generation = (eventSnapshot as { generation?: unknown }).generation;
            if (typeof generation === "number" && generation > (extensionRegistry.snapshot()?.generation ?? -1)) {
                try {
                    extensionRegistry.applySnapshot(this.extensionSessionId, eventSnapshot);
                } catch (error) {
                    this.failSocket(socket, error);
                }
            }
            return;
        }
        if (!this.extensionSessionId && this.extensionHandshakeRequestId === null) {
            const hookSessionId = (value as { sessionId?: unknown }).sessionId;
            if (typeof hookSessionId === "string" && hookSessionId) this.sendExtensionHandshake(socket, hookSessionId);
            return;
        }
        let response;
        try {
            response = parseExtensionBridgeResponse(value);
        } catch {
            return;
        }
        if (response.requestId === this.extensionHandshakeRequestId) {
            if (response.status === "failed") {
                this.failSocket(socket, new Error(response.error?.message ?? "extension handshake failed"));
                return;
            }
            try {
                const data = parseExtensionHandshakeData(response.data);
                if (!["contribution.snapshot", "command.invoke"].every((feature) => data.features.includes(feature))) {
                    throw new Error("extension handshake omitted a required feature");
                }
                this.extensionHandshakeRequestId = null;
                this.extensionSessionId = data.sessionId;
                extensionRegistry.beginSession(data.sessionId);
                extensionRegistry.applySnapshot(data.sessionId, data.snapshot);
            } catch (error) {
                this.failSocket(socket, error);
            }
            return;
        }
        const pending = this.pending.get(response.requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(response.requestId);
        if (response.status === "failed") {
            pending.reject(new Error(response.error?.message ?? "extension bridge request failed"));
            return;
        }
        try {
            pending.resolve(parseExtensionResult(response.data));
        } catch (error) {
            pending.reject(error instanceof Error ? error : new Error(String(error)));
        }
    }

    private sendExtensionHandshake(socket: WebSocket, hookSessionId: string): void {
        const id = requestId("extension-handshake");
        this.extensionHandshakeRequestId = id;
        this.send(socket, {
            method: "loom.extension.handshake",
            params: {
                requestId: id,
                hookSessionId,
                ...extensionProtocolIdentity,
                requiredFeatures: ["contribution.snapshot", "command.invoke"],
                optionalFeatures: ["shortcut.registry", "menu.registry", "notice.effects"],
            },
        });
    }

    private send(socket: WebSocket, payload: unknown): boolean {
        if (this.socket !== socket || socket.readyState !== 1) {
            this.failSocket(socket, new Error("extension bridge socket is unavailable"));
            return false;
        }
        try {
            socket.send(JSON.stringify(payload));
            return true;
        } catch (error) {
            this.failSocket(socket, error);
            return false;
        }
    }

    private failSocket(socket: WebSocket, cause: unknown): void {
        if (this.socket !== socket) return;
        this.socket = null;
        try {
            socket.close();
        } catch {
            // State cleanup below is authoritative even if the runtime cannot close the handle.
        }
        this.disconnect(cause instanceof Error ? cause : new Error(String(cause)));
        this.scheduleReconnect();
    }

    private disconnect(error: Error): void {
        const sessionId = this.extensionSessionId;
        this.extensionSessionId = null;
        this.extensionHandshakeRequestId = null;
        if (sessionId) extensionRegistry.disconnect(sessionId);
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
    }

    private scheduleReconnect(): void {
        if (this.stopped || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, 1_000);
    }
}

export const extensionBridgeClient = new ExtensionBridgeClient();
