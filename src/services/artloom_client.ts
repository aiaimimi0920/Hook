// ArtLoom IPC Client
// Connects to ArtLoom WebSocket server to fetch Arts and settings

const ARTLOOM_WS_URL = "ws://127.0.0.1:19820";

export interface ArtParam {
    id: string;
    label: string;
    widget: string;
    min?: number;
    max?: number;
    step?: number;
    default: any;
    options?: string[];
    multiline?: boolean;
}

export interface ArtDefinition {
    id: string;
    label: string;
    description: string;
    icon: string;
    params: ArtParam[];
    auto_process: boolean;
    enabled: boolean;
}

export interface ShortcutConfig {
    id: string;
    label: string;
    keys: string;
    enabled: boolean;
}

export interface IpcRequest {
    method: string;
    params?: any;
}

export interface IpcResponse {
    type: string;
    data: any;
}

type MessageCallback = (response: IpcResponse) => void;

class ArtLoomIpcClient {
    private ws: WebSocket | null = null;
    private connected = false;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 2000;
    private pendingRequests: Map<string, MessageCallback> = new Map();
    private eventListeners: Map<string, Set<Function>> = new Map();
    private sessionId: string | null = null;

    constructor() {
        this.connect();
    }

    private connect() {
        console.log("[ArtLoom Client] Connecting to", ARTLOOM_WS_URL);

        try {
            this.ws = new WebSocket(ARTLOOM_WS_URL);

            this.ws.onopen = () => {
                console.log("[ArtLoom Client] Connected!");
                this.connected = true;
                this.reconnectAttempts = 0;
                this.emit("connected", {});

                // Perform handshake
                this.handshake();
            };

            this.ws.onmessage = (event) => {
                try {
                    const response: IpcResponse = JSON.parse(event.data);
                    console.log("[ArtLoom Client] Received:", response.type);
                    this.emit("message", response);

                    // Resolve pending request if any
                    // For now, we use a simple approach without request IDs
                } catch (e) {
                    console.error("[ArtLoom Client] Failed to parse message:", e);
                }
            };

            this.ws.onclose = () => {
                console.log("[ArtLoom Client] Disconnected");
                this.connected = false;
                this.sessionId = null;
                this.emit("disconnected", {});
                this.scheduleReconnect();
            };

            this.ws.onerror = (error) => {
                console.error("[ArtLoom Client] WebSocket error:", error);
                this.emit("error", { error });
            };
        } catch (e) {
            console.error("[ArtLoom Client] Connection failed:", e);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`[ArtLoom Client] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            setTimeout(() => this.connect(), this.reconnectDelay);
        } else {
            console.warn("[ArtLoom Client] Max reconnect attempts reached. ArtLoom might not be running.");
            this.emit("max_reconnect_reached", {});
        }
    }

    private async handshake(): Promise<void> {
        const response = await this.send({
            method: "handshake",
            params: { client_version: "1.0.0" }
        });

        if (response?.type === "handshake") {
            this.sessionId = response.data.session_id;
            console.log("[ArtLoom Client] Handshake successful. Session:", this.sessionId);
            this.emit("handshake", response.data);
        }
    }

    private send(request: IpcRequest): Promise<IpcResponse | null> {
        return new Promise((resolve) => {
            if (!this.ws || !this.connected) {
                console.warn("[ArtLoom Client] Not connected, cannot send");
                resolve(null);
                return;
            }

            const json = JSON.stringify(request);
            console.log("[ArtLoom Client] Sending:", request.method);

            // Simple one-shot response handling
            const handler = (event: MessageEvent) => {
                try {
                    const response: IpcResponse = JSON.parse(event.data);
                    this.ws?.removeEventListener("message", handler);
                    resolve(response);
                } catch (e) {
                    resolve(null);
                }
            };

            this.ws.addEventListener("message", handler);
            this.ws.send(json);

            // Timeout after 5 seconds
            setTimeout(() => {
                this.ws?.removeEventListener("message", handler);
                resolve(null);
            }, 5000);
        });
    }

    // Public API

    isConnected(): boolean {
        return this.connected;
    }

    getSessionId(): string | null {
        return this.sessionId;
    }

    async listArts(): Promise<ArtDefinition[]> {
        const response = await this.send({ method: "list_arts" });
        if (response?.type === "arts") {
            return response.data;
        }
        return [];
    }

    async getEnabledArts(): Promise<ArtDefinition[]> {
        const response = await this.send({ method: "get_enabled_arts" });
        if (response?.type === "arts") {
            return response.data;
        }
        return [];
    }

    async getShortcuts(): Promise<ShortcutConfig[]> {
        const response = await this.send({ method: "get_shortcuts" });
        if (response?.type === "shortcuts") {
            return response.data;
        }
        return [];
    }

    async updateArtParam(artId: string, paramId: string, value: any): Promise<boolean> {
        const response = await this.send({
            method: "update_art_param",
            params: { art_id: artId, param_id: paramId, value }
        });
        return response?.type === "success";
    }

    // Event Emitter
    on(event: string, callback: Function) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)!.add(callback);
    }

    off(event: string, callback: Function) {
        this.eventListeners.get(event)?.delete(callback);
    }

    private emit(event: string, data: any) {
        this.eventListeners.get(event)?.forEach(cb => cb(data));
    }

    // Manual reconnect
    reconnect() {
        this.reconnectAttempts = 0;
        if (this.ws) {
            this.ws.close();
        }
        this.connect();
    }

    // Disconnect
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Singleton instance
export const artLoomClient = new ArtLoomIpcClient();
