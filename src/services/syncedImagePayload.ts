import type { Unit } from "../types/unit";

type ImagePayloadUnit = Pick<Unit, "data">;

export const normalizePreviewSrc = (unit: ImagePayloadUnit) => {
    const previewSrc = unit.data.previewSrc;
    if (!previewSrc || previewSrc === unit.data.src) {
        return undefined;
    }
    return previewSrc;
};

export const isFileBackedImage = (unit: ImagePayloadUnit) =>
    Boolean(unit.data.filePath);

export const buildSyncedImagePayload = (unit: ImagePayloadUnit) => {
    const previewSrc = isFileBackedImage(unit) ? undefined : normalizePreviewSrc(unit);
    return {
        src: unit.data?.src,
        ...(unit.data.filePath ? { filePath: unit.data.filePath } : {}),
        ...(previewSrc ? { previewSrc } : {}),
        rasterizedAnnotationLayerSrc: unit.data?.rasterizedAnnotationLayerSrc || null,
    };
};
