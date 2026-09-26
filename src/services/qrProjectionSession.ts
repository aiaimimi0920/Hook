import { graphStore } from "../store/graphStore";
import { selectionActions } from "../store/uiStore";
import type { ProjectionResponse, QrProjectionLink } from "../types/qrProjection";
import type { Unit } from "../types/unit";
import { clearSyncImageCachesForUnit } from "./syncImageCache";
import { shaderCache } from "./shaderCache";
import { syncService } from "./syncService";

export const projectionLinkFromResponse = (role: QrProjectionLink["role"], unitId: string, response: ProjectionResponse): QrProjectionLink => ({
    role, localUnitId: unitId, envelope: response.envelope, revision: response.revision,
    digest: response.digest, linked: response.receiverDeviceId !== null,
    ...(response.offlineTransport ? { offlineTransport: response.offlineTransport } : {}),
});

export function patchProjection(unitId: string, link: QrProjectionLink | undefined, imageBase64?: string): void {
    if (!graphStore.units.some((unit) => unit.id === unitId)) return;
    if (imageBase64) {
        clearSyncImageCachesForUnit(unitId);
        shaderCache.disposeUnit(unitId);
    }
    // Only replace source pixels. The receiver owns its frame, opacity and local edit layers.
    graphStore.actions.updateUnitData(unitId, {
        qrProjection: link,
        ...(imageBase64 ? { src: `data:image/png;base64,${imageBase64}`, filePath: undefined,
            previewSrc: undefined, outputs: undefined, restoredPreviewLocked: false } : {}),
    });
    void syncService.performWorkflowSync();
}

export function createProjectionReceiverUnit(id: string, response: ProjectionResponse, viewport: { width: number; height: number }): Unit {
    if (!response.snapshot || response.receiverUnitId !== id || !response.receiverDeviceId || !response.linked) {
        throw new Error("projection_invalid_response");
    }
    const { width, height, imageBase64 } = response.snapshot;
    const scale = Math.min(1, 480 / width, 360 / height, Math.max(1, viewport.width - 32) / width, Math.max(1, viewport.height - 32) / height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    return {
        id, type: "sticker", x: Math.max(0, (viewport.width - w) / 2), y: Math.max(0, (viewport.height - h) / 2), w, h,
        params: {}, inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }],
        outputs: [{ id: "output_image", type: "image", direction: "output", label: "Image" }],
        data: { src: `data:image/png;base64,${imageBase64}`, opacityNormal: 1, opacityMini: 0.9,
            qrProjection: projectionLinkFromResponse("receiver", id, response) },
    };
}

export function attachProjectionReceiver(id: string, response: ProjectionResponse): void {
    if (graphStore.units.some((unit) => unit.id === id)) throw new Error("projection_invalid_response");
    graphStore.actions.addUnit(createProjectionReceiverUnit(id, response, { width: window.innerWidth, height: window.innerHeight }));
    selectionActions.set([id]);
    void syncService.updateBackendRects();
    void syncService.performWorkflowSync();
}
