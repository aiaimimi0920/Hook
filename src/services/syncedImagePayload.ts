import type { Unit } from "../types/unit";

type ImagePayloadUnit = Pick<Unit, "type" | "w" | "h" | "data">;
interface SyncedImageSignatureOptions {
    displaySrcOverride?: string | null;
}

export interface SyncedImagePayload {
    src: string | undefined;
    filePath?: string;
    previewSrc?: string;
    rasterizedAnnotationLayerSrc: string | null;
}

interface BuildSyncedImagePayloadOptions<TUnit extends ImagePayloadUnit> {
    renderBakedPreviewSrc?: (unit: TUnit) => Promise<string>;
}

const hasMeaningfulImageEditState = (
    imageEditState: Unit["data"]["imageEditState"] | null | undefined,
) => {
    if (!imageEditState) return false;
    return (
        (imageEditState.contentEraseStrokes?.length ?? 0) > 0 ||
        !!imageEditState.cropRect ||
        !!imageEditState.sourceSize ||
        !!imageEditState.rotation ||
        !!imageEditState.flippedX ||
        !!imageEditState.flippedY ||
        (imageEditState.borderWidth ?? 0) > 0 ||
        !!imageEditState.borderColor ||
        (imageEditState.cornerRadius ?? 0) > 0 ||
        !!imageEditState.beautify?.enabled
    );
};

export const normalizePreviewSrc = (unit: Pick<Unit, "data">) => {
    const previewSrc = unit.data.previewSrc;
    if (!previewSrc || previewSrc === unit.data.src) {
        return undefined;
    }
    return previewSrc;
};

export const isFileBackedImage = (unit: Pick<Unit, "data">) =>
    Boolean(unit.data.filePath);

export const requiresBakedStickerSyncImage = (unit: ImagePayloadUnit) => {
    if (unit.type !== "sticker") return false;
    if ((unit.data.annotationState?.elements?.length ?? 0) > 0) return true;
    if (Boolean(unit.data.rasterizedAnnotationLayerSrc)) return true;
    return hasMeaningfulImageEditState(unit.data.imageEditState);
};

export const buildSyncedImageSignature = (
    unit: ImagePayloadUnit,
    options: SyncedImageSignatureOptions = {},
) => {
    const previewSrc = isFileBackedImage(unit) ? undefined : normalizePreviewSrc(unit);
    if (!requiresBakedStickerSyncImage(unit)) {
        const directImageSource = unit.data.filePath || previewSrc || unit.data.src;
        if (!directImageSource) return undefined;
        return JSON.stringify({
            mode: "direct",
            type: unit.type,
            src: unit.data.src ?? null,
            previewSrc: previewSrc ?? null,
            filePath: unit.data.filePath ?? null,
            rasterizedAnnotationLayerSrc: unit.data.rasterizedAnnotationLayerSrc ?? null,
        });
    }

    return JSON.stringify({
        mode: "baked",
        type: unit.type,
        w: unit.w,
        h: unit.h,
        displaySrc: options.displaySrcOverride ?? null,
        src: unit.data.src ?? null,
        previewSrc: previewSrc ?? null,
        filePath: unit.data.filePath ?? null,
        rasterizedAnnotationLayerSrc: unit.data.rasterizedAnnotationLayerSrc ?? null,
        annotationState: unit.data.annotationState ?? null,
        imageEditState: unit.data.imageEditState ?? null,
    });
};

export const buildSyncedImagePayload = async <TUnit extends ImagePayloadUnit>(
    unit: TUnit,
    options: BuildSyncedImagePayloadOptions<TUnit> = {},
): Promise<SyncedImagePayload> => {
    if (requiresBakedStickerSyncImage(unit)) {
        if (!options.renderBakedPreviewSrc) {
            throw new Error(
                "renderBakedPreviewSrc is required when building a baked sticker sync payload",
            );
        }
        const bakedPreviewSrc = await options.renderBakedPreviewSrc(unit);
        return {
            src: bakedPreviewSrc,
            rasterizedAnnotationLayerSrc: null,
        };
    }

    const previewSrc = isFileBackedImage(unit) ? undefined : normalizePreviewSrc(unit);
    return {
        src: unit.data?.src,
        ...(unit.data.filePath ? { filePath: unit.data.filePath } : {}),
        ...(previewSrc ? { previewSrc } : {}),
        rasterizedAnnotationLayerSrc: unit.data?.rasterizedAnnotationLayerSrc || null,
    };
};
