import { api } from "./api";

import { listen } from "@tauri-apps/api/event";
import { logger } from "./logger";
import { HandshakeRequest, HandshakeResponse, TransportMode, ArtDelivery, ArtCapability } from "./protocol";
import { normalizeArtCapabilities } from "./artCapabilityNormalization";
import type {
    SurfaceActionAck,
    SurfaceActionCancelRequest,
    SurfaceActionProgress,
    SurfaceConfirmationDecision,
    SurfaceConfirmationRequest,
    SurfaceEvent,
    SurfaceExecutionFailure,
    SurfaceLifecycleEvent,
    SurfacePatch,
    SurfacePreviewCommit,
    SurfaceResultCommit,
    SurfaceResourceLease,
    SurfaceSnapshot,
} from "./surfaceProtocol";
import { hookSurfaceHostCapabilities } from "./surfaceHostCapabilities";

export interface SurfaceSnapshotDelivery {
    hookNodeId: string;
    snapshot: SurfaceSnapshot;
    generation: number;
}

export interface SurfacePatchDelivery {
    hookNodeId: string;
    patch: SurfacePatch;
    generation: number;
}

export interface SurfaceGenerationDelivery {
    hookNodeId: string;
    instanceId: string;
    attachmentId: string;
    generation: number;
}

export interface SurfaceDisposeDelivery {
    hookNodeId: string;
    instanceId: string;
    attachmentId: string;
}

export interface SurfaceLifecycleDelivery {
    hookNodeId: string;
    event: SurfaceLifecycleEvent;
}

export interface SurfacePreviewDelivery {
    hookNodeId: string;
    commit: SurfacePreviewCommit;
}

export interface SurfaceResultDelivery {
    hookNodeId: string;
    commit: SurfaceResultCommit;
}

export interface SurfaceFailureDelivery {
    hookNodeId?: string;
    failure: SurfaceExecutionFailure;
}

export interface SurfaceResourceDelivery {
    leaseId: string;
    resourceId: string;
    dataUrl: string;
    expiresAtMs: number;
}

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

    async dispatchSurfaceEvent(event: SurfaceEvent) {
        await this.dispatchAction("surface_event", { event });
    }

    async dispatchSurfaceLifecycle(event: SurfaceLifecycleEvent) {
        await this.dispatchAction("surface_lifecycle", { event });
    }

    async decideSurfaceConfirmation(decision: SurfaceConfirmationDecision) {
        await this.dispatchAction("surface_confirmation", { decision });
    }

    async cancelSurfaceAction(request: SurfaceActionCancelRequest) {
        await this.dispatchAction("surface_cancel", { request });
    }

    async fetchSurfaceResource(lease: SurfaceResourceLease) {
        await this.dispatchAction("surface_resource", { lease });
    }

    async attachSurface(artId: string, hookNodeId: string) {
        await this.dispatchAction("surface_attach", {
            art_id: artId,
            hook_node_id: hookNodeId,
            capabilities: hookSurfaceHostCapabilities(),
        });
    }

    async remountSurface(instanceId: string, attachmentId: string, hookNodeId: string) {
        await this.dispatchAction("surface_remount", {
            instance_id: instanceId,
            attachment_id: attachmentId,
            hook_node_id: hookNodeId,
        });
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

    async listenForSurfaceSnapshot(callback: (delivery: SurfaceSnapshotDelivery) => void) {
        return await listen<SurfaceSnapshotDelivery>("surface/snapshot", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfacePatch(callback: (delivery: SurfacePatchDelivery) => void) {
        return await listen<SurfacePatchDelivery>("surface/patch", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfaceGeneration(callback: (delivery: SurfaceGenerationDelivery) => void) {
        return await listen<SurfaceGenerationDelivery>("surface/generation", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfaceActionAck(callback: (ack: SurfaceActionAck) => void) {
        return await listen<SurfaceActionAck>("surface/action_ack", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfaceConfirmation(callback: (request: SurfaceConfirmationRequest) => void) {
        return await listen<SurfaceConfirmationRequest>("surface/confirmation", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfaceProgress(callback: (progress: SurfaceActionProgress) => void) {
        return await listen<SurfaceActionProgress>("surface/progress", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfacePreview(callback: (delivery: SurfacePreviewDelivery) => void) {
        return await listen<SurfacePreviewDelivery>("surface/preview", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfaceResult(callback: (delivery: SurfaceResultDelivery) => void) {
        return await listen<SurfaceResultDelivery>("surface/result", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfaceFailure(callback: (delivery: SurfaceFailureDelivery) => void) {
        return await listen<SurfaceFailureDelivery>("surface/failure", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfaceLifecycle(callback: (delivery: SurfaceLifecycleDelivery) => void) {
        return await listen<SurfaceLifecycleDelivery>("surface/lifecycle", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfaceDispose(callback: (delivery: SurfaceDisposeDelivery) => void) {
        return await listen<SurfaceDisposeDelivery>("surface/dispose", (event) => {
            callback(event.payload);
        });
    }

    async listenForSurfaceResource(callback: (delivery: SurfaceResourceDelivery) => void) {
        return await listen<SurfaceResourceDelivery>("surface/resource", (event) => {
            callback(event.payload);
        });
    }
}

export const artLoom = new ArtLoomClient();
