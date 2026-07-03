import { unwrap } from "solid-js/store";
import type { Unit } from "../types/unit";

export interface FrozenStickerSessionSnapshot {
    id: string;
    src: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minified: boolean;
    savedRect: Unit["data"]["savedRect"] | null;
    cropOffset: Unit["data"]["cropOffset"] | null;
    opacityNormal: number;
    opacityMini: number;
    previewSrc: string | null;
    filePath: string | null;
    rasterizedAnnotationLayerSrc: string | null;
    annotationState: Unit["data"]["annotationState"] | null;
    imageEditState: Unit["data"]["imageEditState"] | null;
    captureMeta: Unit["data"]["captureMeta"] | null;
}

export interface FrozenStickerEntry {
    entryId: string;
    sourceStickerId: string;
    createdAt: string;
    snapshot: FrozenStickerSessionSnapshot;
}

export const captureFrozenStickerSnapshot = (unit: Unit): FrozenStickerEntry => ({
    entryId: crypto.randomUUID(),
    sourceStickerId: unit.id,
    createdAt: new Date().toISOString(),
    snapshot: structuredClone(unwrap({
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
        previewSrc: unit.data.previewSrc || null,
        filePath: unit.data.filePath || null,
        rasterizedAnnotationLayerSrc: unit.data.rasterizedAnnotationLayerSrc || null,
        annotationState: unit.data.annotationState || null,
        imageEditState: unit.data.imageEditState || null,
        captureMeta: unit.data.captureMeta || null,
    })),
});

export const instantiateStickerFromFrozenSnapshot = (
    entry: FrozenStickerEntry,
    mouse: { x: number; y: number },
): Unit => ({
    id: crypto.randomUUID(),
    type: "sticker",
    x: mouse.x + 50,
    y: mouse.y + 50,
    w: entry.snapshot.w,
    h: entry.snapshot.h,
    params: {},
    inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }],
    outputs: [{ id: "output_image", type: "image", direction: "output", label: "Image" }],
    data: {
        src: entry.snapshot.src,
        minified: entry.snapshot.minified,
        savedRect: entry.snapshot.savedRect || undefined,
        cropOffset: entry.snapshot.cropOffset || undefined,
        opacityNormal: entry.snapshot.opacityNormal,
        opacityMini: entry.snapshot.opacityMini,
        previewSrc: entry.snapshot.previewSrc || undefined,
        filePath: entry.snapshot.filePath || undefined,
        rasterizedAnnotationLayerSrc: entry.snapshot.rasterizedAnnotationLayerSrc || undefined,
        annotationState: entry.snapshot.annotationState || undefined,
        imageEditState: entry.snapshot.imageEditState || undefined,
        captureMeta: entry.snapshot.captureMeta || undefined,
    },
});
