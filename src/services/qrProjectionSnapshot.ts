import { unwrap } from "solid-js/store";
import type { Unit } from "../types/unit";
import type { ProjectionSnapshot } from "../types/qrProjection";
import { isLiveCaptureUnit } from "./liveCaptureUnit";
import { MAX_PROJECTION_IMAGE_BYTES } from "./qrProjectionProtocol";
import { loadImage } from "./stickerCanvas";
import { renderStickerComposite } from "./stickerExportOperations";
import { resolveRuntimeStickerCompositeBaseImageSrc } from "./stickerExportSource";
import { buildSyncedImageSignature, resolveBakedStickerSyncSize } from "./syncedImagePayload";

export interface ProjectionFrame { snapshot: ProjectionSnapshot; digest: string }

export function projectionContentSignature(unit: Unit): string {
    // Art graph outputs can change without changing the node's own src.
    return JSON.stringify([
        buildSyncedImageSignature(unit), resolveRuntimeStickerCompositeBaseImageSrc(unit),
        unit.data.opacityNormal, unit.data.imageEditState, unit.data.annotationState,
    ]);
}

const checkSize = (width: number, height: number) => {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || width > 8192 || height > 8192 || width * height > 16_777_216) throw new Error("projection_image_budget");
};

export async function renderProjectionFrame(unit: Unit, options: { withoutAnnotations?: boolean } = {}): Promise<ProjectionFrame> {
    if (isLiveCaptureUnit(unit.id)) throw new Error("projection_live_unsupported");
    const frozen: Unit = structuredClone(unwrap(unit));
    if (options.withoutAnnotations) {
        frozen.data.annotationState = undefined;
        frozen.data.opacityNormal = 1;
    }
    const source = resolveRuntimeStickerCompositeBaseImageSrc(frozen);
    if (!source) throw new Error("projection_no_image");
    const base = await loadImage(source);
    checkSize(base.naturalWidth || base.width, base.naturalHeight || base.height);
    const size = resolveBakedStickerSyncSize(frozen);
    const rendered = await renderStickerComposite({ ...frozen, ...size }, { liveSnapshotPrepared: true });
    const image = await loadImage(rendered);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    checkSize(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("projection_no_image");
        context.drawImage(image, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        const imageBase64 = dataUrl.slice("data:image/png;base64,".length);
        if (!dataUrl.startsWith("data:image/png;base64,") || imageBase64.length > Math.ceil(MAX_PROJECTION_IMAGE_BYTES / 3) * 4) {
            throw new Error("projection_image_budget");
        }
        const bytes = Uint8Array.from(atob(imageBase64), (char) => char.charCodeAt(0));
        if (bytes.byteLength > MAX_PROJECTION_IMAGE_BYTES) throw new Error("projection_image_budget");
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        const digest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
        return { snapshot: { imageBase64, width, height }, digest };
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}
