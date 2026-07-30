import type { Unit, SessionSticker } from "../types/unit";
import {
    buildSyncedImageSignature,
    normalizePreviewSrc,
    requiresBakedStickerSyncImage,
} from "./syncedImagePayload";

export const mapUnitToSessionSticker = (unit: Unit): SessionSticker => ({
    id: unit.id,
    src: unit.data.src || "",
    x: unit.x,
    y: unit.y,
    w: unit.w,
    h: unit.h,
    minified: unit.data.minified ?? false,
    savedRect: unit.data.savedRect || null,
    cropOffset: unit.data.cropOffset || null,
    opacityNormal: unit.data.opacityNormal ?? 1,
    opacityMini: unit.data.opacityMini ?? 0.9,
    type: unit.type,
    artId: unit.artId || null,
    params: unit.params || {},
    filePath: unit.data.filePath || null,
    previewSrc: normalizePreviewSrc(unit) || null,
    rasterizedAnnotationLayerSrc: unit.data.rasterizedAnnotationLayerSrc || null,
    outputs: unit.data.outputs || null,
    originWorkflowId: unit.data.originWorkflowId || null,
    originNodeId: unit.data.originNodeId || null,
    executionConfig: unit.data.executionConfig || null,
    annotationState: unit.data.annotationState || null,
    imageEditState: unit.data.imageEditState || null,
    groupId: unit.data.groupId || null,
    captureMeta: unit.data.captureMeta || null,
});

interface BuildSessionStickersForSaveOptions {
    renderBakedPreviewSrc: (unit: Unit) => Promise<string>;
    previewCache: Map<string, { signature: string; src: string }>;
    buildPreviewSignature?: (unit: Unit) => string | undefined;
    paramsByUnitId?: Record<string, Record<string, unknown>>;
}

export const buildSessionStickersForSave = async (
    units: Unit[],
    options: BuildSessionStickersForSaveOptions,
): Promise<SessionSticker[]> =>
    Promise.all(
        units.map(async (unit) => {
            const base = mapUnitToSessionSticker(unit);
            const params = options.paramsByUnitId?.[unit.id];
            const normalizedBase =
                params === undefined
                    ? base
                    : {
                          ...base,
                          params,
                      };
            if (!requiresBakedStickerSyncImage(unit)) {
                return normalizedBase;
            }

            const signature =
                options.buildPreviewSignature?.(unit) ?? buildSyncedImageSignature(unit);
            if (!signature) {
                return normalizedBase;
            }

            const cached = options.previewCache.get(unit.id);
            if (cached?.signature === signature) {
                return {
                    ...normalizedBase,
                    previewSrc: cached.src,
                };
            }

            try {
                const bakedPreviewSrc = await options.renderBakedPreviewSrc(unit);
                options.previewCache.set(unit.id, { signature, src: bakedPreviewSrc });
                return {
                    ...normalizedBase,
                    previewSrc: bakedPreviewSrc,
                };
            } catch (error) {
                console.error("Bake sticker preview for session persistence failed", unit.id, error);
                return normalizedBase;
            }
        }),
    );
