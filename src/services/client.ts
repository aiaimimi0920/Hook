import { api } from "./api";

import { listen } from "@tauri-apps/api/event";
import { logger } from "./logger";
import { HandshakeRequest, HandshakeResponse, TransportMode, ArtDelivery, ArtCapability } from "./protocol";
import { normalizeArtCapabilities } from "./artCapabilityNormalization";

export class ArtLoomClient {
    private sessionId: string | null = null;
    private negotiatedTransport: TransportMode | null = null;
    private capabilities: ArtCapability[] = [];

    async connect(): Promise<HandshakeResponse> {
        logger.debug("[ArtLoomClient] Connecting...");
        const req: HandshakeRequest = {
            client_name: "hook-frontend",
            client_version: "1.0.0",
            preferred_transports: ["shared_memory", "cloudflare_relay"]
        };

        try {
            const rawResponse = await api.handshake(req);
            const capabilities = normalizeArtCapabilities(
                rawResponse.capabilities?.art_definitions ?? [],
            );
            const res: HandshakeResponse = {
                ...rawResponse,
                capabilities: {
                    ...rawResponse.capabilities,
                    art_definitions: capabilities,
                },
            };

            logger.debug("[ArtLoomClient] Handshake Success:", res);
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
        logger.debug(`[ArtLoomClient] Dispatching ${actionName}:`, actionEnum);
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
        logger.debug(`[ArtLoomClient] Syncing Workflow ${workflowId}`);
        await this.dispatchAction("sync_workflow", payload);
    }

    async listenForProgress(callback: (artId: string, progress: number) => void) {
        return await listen<{art_id: string, value: number}>("art/progress", (event) => {
            callback(event.payload.art_id, event.payload.value);
        });
    }

    async listenForDelivery(callback: (delivery: ArtDelivery) => void) {
        return await listen<ArtDelivery>("art/ready", (event) => {
            logger.debug("[ArtLoomClient] Delivery Received:", event.payload);
            callback(event.payload);
        });
    }
}

export const artLoom = new ArtLoomClient();
