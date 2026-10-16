import { describe, expect, it } from "vitest";
import { computeNextCropFrame, computeRestoredCropFrame } from "../../src/features/stickers/services/stickerEditingGeometry";
import { buildStickerCropEdit, buildStickerCropReset } from "../../src/features/stickers/services/stickerCropEdits";
import { computeCroppedImagePlacement, croppedImageSourceResolution } from "../../src/features/stickers/services/stickerCropImage";
import type { Unit } from "../../src/features/workspace/types/unit";

const sticker = (): Unit => ({
    id: "crop", type: "sticker", x: 100, y: 200, w: 400, h: 300, params: {}, inputs: [], outputs: [],
    data: {
        annotationState: { serialCounter: 4, elements: [
            { id: "rect", type: "rect", x: 120, y: 80, w: 60, h: 40, rotation: 15, zIndex: 1, style: { color: "red", width: 3 } },
            { id: "text", type: "text", x: 130, y: 100, text: "标注", fontSize: 20, zIndex: 2, style: { color: "red", width: 1 } },
            { id: "arrow", type: "arrow", points: [{ x: 150, y: 90 }, { x: 200, y: 110 }], zIndex: 3, style: { color: "red", width: 4 } },
            { id: "blur", type: "blur", x: 110, y: 70, w: 80, h: 30, points: [{ x: 120, y: 80 }, { x: 180, y: 90 }], brushWidth: 20, strength: 8, zIndex: 4, style: { color: "red", width: 0 } },
            { id: "outside", type: "rect", x: 10, y: 10, w: 20, h: 20, zIndex: 5, style: { color: "red", width: 3 } },
        ] },
        imageEditState: { contentEraseStrokes: [{ id: "erase", points: [{ x: 140, y: 100 }], width: 12, opacity: 1, color: "black" }] },
    },
});
const apply = (unit: Unit, change: ReturnType<typeof buildStickerCropEdit>): Unit => ({
    ...unit, ...change.frame, data: { ...unit.data, ...change.data },
});

describe("crop coordinates after resizing a cropped sticker", () => {
    const state = { cropRect: { x: 100, y: 50, w: 200, h: 100 }, sourceSize: { w: 400, h: 200 } };
    const frame = { x: 500, y: 300, w: 400, h: 200 };

    it("maps a second displayed selection back into the retained source frame", () => {
        expect(computeNextCropFrame(frame, state, { x: 60, y: 40, w: 200, h: 100 })).toEqual({
            unitRect: { x: 560, y: 340, w: 200, h: 100 },
            cropRect: { x: 130, y: 70, w: 100, h: 50 },
            sourceSize: { w: 400, h: 200 },
        });
    });

    it("restores the full source without changing its current displayed scale", () => {
        expect(computeRestoredCropFrame(frame, state)).toEqual({ x: 300, y: 200, w: 800, h: 400 });
    });
});

describe("crop translates annotations rather than scaling or discarding them", () => {
    it("moves all coordinate forms together and preserves appearance and off-crop geometry", () => {
        const original = sticker();
        const cropped = apply(original, buildStickerCropEdit(original, { x: 100, y: 60, w: 200, h: 150 }));
        expect(cropped.data.annotationState?.elements[0]).toMatchObject({ x: 20, y: 20, w: 60, h: 40, rotation: 15, style: { width: 3 } });
        expect(cropped.data.annotationState?.elements[1]).toMatchObject({ x: 30, y: 40, fontSize: 20 });
        expect(cropped.data.annotationState?.elements[2]).toMatchObject({ points: [{ x: 50, y: 30 }, { x: 100, y: 50 }] });
        expect(cropped.data.annotationState?.elements[3]).toMatchObject({ x: 10, y: 10, points: [{ x: 20, y: 20 }, { x: 80, y: 30 }], brushWidth: 20 });
        expect(cropped.data.annotationState?.elements[4]).toMatchObject({ x: -90, y: -50 });
        expect(cropped.data.imageEditState?.contentEraseStrokes[0]).toMatchObject({ points: [{ x: 40, y: 40 }], width: 12 });
        expect(original).toEqual(sticker());
        const restored = apply(cropped, buildStickerCropReset(cropped));
        expect(restored).toMatchObject({ x: 100, y: 200, w: 400, h: 300 });
        expect(restored.data.annotationState).toEqual(original.data.annotationState);
        expect(restored.data.imageEditState?.contentEraseStrokes).toEqual(original.data.imageEditState?.contentEraseStrokes);
        expect(restored.data.imageEditState?.sourceSize).toBeUndefined();
    });

    it("composes repeated crops and restores their accumulated translation", () => {
        const original = sticker();
        const first = apply(original, buildStickerCropEdit(original, { x: 50, y: 40, w: 300, h: 200 }));
        const second = apply(first, buildStickerCropEdit(first, { x: 30, y: 20, w: 200, h: 100 }));
        expect(second.data.imageEditState?.cropRect).toEqual({ x: 80, y: 60, w: 200, h: 100 });
        expect(second.data.annotationState?.elements[0]).toMatchObject({ x: 40, y: 20 });
        const restored = apply(second, buildStickerCropReset(second));
        expect(restored.data.annotationState).toEqual(original.data.annotationState);
    });
});

describe("cropped base image keeps its pre-crop contain geometry", () => {
    it("uses logical crop coordinates even when the source has twice the pixel density", () => {
        const state = { sourceSize: { w: 400, h: 200 }, cropRect: { x: 100, y: 50, w: 200, h: 100 } };
        expect(computeCroppedImagePlacement({ x: 0, y: 0, w: 200, h: 100 }, state, { width: 800, height: 400 }))
            .toEqual({ left: -100, top: -50, width: 400, height: 200 });
        expect(croppedImageSourceResolution(state, { width: 800, height: 400 })).toEqual({ width: 400, height: 200 });
    });

    it("retains letterbox margins instead of stretching the source when cropping", () => {
        const state = { sourceSize: { w: 400, h: 400 }, cropRect: { x: 50, y: 80, w: 250, h: 200 } };
        expect(computeCroppedImagePlacement({ x: 0, y: 0, w: 250, h: 200 }, state, { width: 800, height: 400 }))
            .toEqual({ left: -50, top: 20, width: 400, height: 200 });
    });
});
