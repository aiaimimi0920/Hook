import type { Unit } from "../types/unit";

export interface StickerAsyncEditGuard {
    unitId: string;
    type: Unit["type"];
    frame: Pick<Unit, "x" | "y" | "w" | "h">;
    source: Pick<
        Unit["data"],
        "src" | "previewSrc" | "resultHandle" | "filePath" | "rasterizedAnnotationLayerSrc"
    >;
    editStateJson: string;
}

const serializeEditState = (unit: Unit) => JSON.stringify({
    annotationState: unit.data.annotationState ?? null,
    imageEditState: unit.data.imageEditState ?? null,
});

/** Captures the inputs that asynchronous sticker bitmap work is allowed to replace. */
export const createStickerAsyncEditGuard = (unit: Unit): StickerAsyncEditGuard => ({
    unitId: unit.id,
    type: unit.type,
    frame: { x: unit.x, y: unit.y, w: unit.w, h: unit.h },
    source: {
        src: unit.data.src,
        previewSrc: unit.data.previewSrc,
        resultHandle: unit.data.resultHandle,
        filePath: unit.data.filePath,
        rasterizedAnnotationLayerSrc: unit.data.rasterizedAnnotationLayerSrc,
    },
    // Compare large image strings directly; only editable vector/stroke state is serialized.
    editStateJson: serializeEditState(unit),
});

export const isStickerAsyncEditGuardCurrent = (
    guard: StickerAsyncEditGuard,
    unit: Unit | undefined,
) =>
    !!unit &&
    unit.id === guard.unitId &&
    unit.type === guard.type &&
    unit.x === guard.frame.x &&
    unit.y === guard.frame.y &&
    unit.w === guard.frame.w &&
    unit.h === guard.frame.h &&
    unit.data.src === guard.source.src &&
    unit.data.previewSrc === guard.source.previewSrc &&
    unit.data.resultHandle === guard.source.resultHandle &&
    unit.data.filePath === guard.source.filePath &&
    unit.data.rasterizedAnnotationLayerSrc === guard.source.rasterizedAnnotationLayerSrc &&
    serializeEditState(unit) === guard.editStateJson;
