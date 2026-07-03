import { api } from "./api";

import { listen } from "@tauri-apps/api/event";
import { HandshakeRequest, HandshakeResponse, TransportMode, PropChange, ArtDelivery } from "./protocol";

export class ArtLoomClient {
    private sessionId: string | null = null;
    private negotiatedTransport: TransportMode | null = null;
    private capabilities: any[] = [];

    async connect(): Promise<HandshakeResponse> {
        console.log("[ArtLoomClient] Connecting...");
        const req: HandshakeRequest = {
            client_name: "hook-frontend",
            client_version: "1.0.0",
            preferred_transports: ["shared_memory", "cloudflare_relay"]
        };

        try {
            const res = await api.handshake(req);

            console.log("[ArtLoomClient] Handshake Success:", res);
            this.sessionId = res.session_id;
            this.negotiatedTransport = res.negotiated_transport;
            this.capabilities = res.capabilities.art_definitions;
            return res;
        } catch (e) {
            console.error("[ArtLoomClient] Handshake Failed:", e);
            throw e;
        }
    }

    async dispatchAction(actionName: string, payload: any) {
        // Construct the Enum Object matching backend #[serde(tag = "action", content = "payload")]
        const actionEnum = {
            action: actionName,
            payload: payload
        };
        console.log(`[ArtLoomClient] Dispatching ${actionName}:`, actionEnum);
        // Pass to the 'action' argument of the Rust command
        await api.dispatchAction(actionEnum);

    }

    async updateProperty(artId: string, propId: string, value: any) {
        // Match backend UpdateNodeParam struct
        const payload = {
            node_id: artId,
            param_key: propId,
            value
        };
        await this.dispatchAction("update_node_param", payload);
    }

    async syncWorkflow(workflowId: string, snapshot: any) {
        const payload = {
            workflow_id: workflowId,
            snapshot: snapshot
        };
        console.log(`[ArtLoomClient] Syncing Workflow ${workflowId}`);
        await this.dispatchAction("sync_workflow", payload);
    }

    async listenForProgress(callback: (artId: string, progress: number) => void) {
        return await listen<{art_id: string, value: number}>("art/progress", (event) => {
            callback(event.payload.art_id, event.payload.value);
        });
    }

    async listenForDelivery(callback: (delivery: ArtDelivery) => void) {
        return await listen<ArtDelivery>("art/ready", (event) => {
            console.log("[ArtLoomClient] Delivery Received:", event.payload);
            callback(event.payload);
        });
    }
}

export const artLoom = new ArtLoomClient();
