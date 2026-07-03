import { describe, expect, it } from "vitest";

import {
    createRasterizedStickerData,
    getRasterizableAnnotationIds,
} from "../../src/services/stickerRasterize";
import type { Unit } from "../../src/types/unit";

const makeUnit = (): Unit => ({
    id: "sticker-1",
    type: "sticker",
    x: 10,
    y: 20,
    w: 200,
    h: 120,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        src: "data:image/png;base64,ORIGINAL",
        previewSrc: "data:image/png;base64,PREVIEW",
        resultHandle: "old-handle",
        filePath: "C:/tmp/old.png",
        rasterizedAnnotationLayerSrc: "data:image/png;base64,OLD_LAYER",
        annotationState: {
            serialCounter: 7,
            elements: [
                {
                    id: "shape-1",
                    type: "rect",
                    zIndex: 1,
                    x: 10,
                    y: 12,
                    w: 40,
                    h: 30,
                    style: { color: "#fff", width: 2 },
                },
                {
                    id: "text-1",
                    type: "text",
                    zIndex: 2,
                    x: 20,
                    y: 24,
                    text: "secret",
                    style: { color: "#fff", width: 1 },
                },
                {
                    id: "mosaic-1",
                    type: "mosaic",
                    zIndex: 3,
                    x: 30,
                    y: 32,
                    w: 50,
                    h: 20,
                    strength: 16,
                    style: { color: "#fff", width: 1 },
                },
            ],
        },
        imageEditState: {
            contentEraseStrokes: [
                {
                    id: "erase-1",
                    color: "#000",
                    opacity: 1,
                    width: 12,
                    points: [
                        { x: 0, y: 0 },
                        { x: 20, y: 20 },
                    ],
                },
            ],
            cropRect: { x: 5, y: 6, w: 160, h: 90 },
            sourceSize: { w: 220, h: 140 },
            flippedX: true,
            borderWidth: 4,
            borderColor: "#ef4444",
            cornerRadius: 18,
        },
    },
});

describe("sticker rasterize state helpers", () => {
    it("resolves selected and all rasterization scopes without inventing missing ids", () => {
        const unit = makeUnit();

        expect(getRasterizableAnnotationIds(unit, "selected", "text-1")).toEqual(["text-1"]);
        expect(getRasterizableAnnotationIds(unit, "selected", ["text-1", "mosaic-1"])).toEqual([
            "text-1",
            "mosaic-1",
        ]);
        expect(getRasterizableAnnotationIds(unit, "selected", ["text-1", "missing", "text-1"])).toEqual([
            "text-1",
        ]);
        expect(getRasterizableAnnotationIds(unit, "selected", "missing")).toEqual([]);
        expect(getRasterizableAnnotationIds(unit, "selected", null)).toEqual([]);
        expect(getRasterizableAnnotationIds(unit, "all", null)).toEqual([
            "shape-1",
            "text-1",
            "mosaic-1",
        ]);
    });

    it("splits rasterized controls into a base layer and a transparent annotation layer", () => {
        const unit = makeUnit();

        const patch = createRasterizedStickerData(
            unit,
            {
                baseLayerSrc: "data:image/png;base64,BASE",
                rasterizedAnnotationLayerSrc: "data:image/png;base64,LAYER",
                previewSrc: "data:image/png;base64,PREVIEW_COMPOSITE",
            },
            ["text-1"],
        );

        expect(patch.src).toBe("data:image/png;base64,BASE");
        expect(patch.previewSrc).toBe("data:image/png;base64,PREVIEW_COMPOSITE");
        expect(patch.rasterizedAnnotationLayerSrc).toBe("data:image/png;base64,LAYER");
        expect(patch.resultHandle).toBeUndefined();
        expect(patch.filePath).toBeUndefined();
        expect(patch.imageEditState).toEqual({ contentEraseStrokes: [] });
        expect(patch.annotationState?.serialCounter).toBe(7);
        expect(patch.annotationState?.elements.map((item) => item.id)).toEqual([
            "shape-1",
            "mosaic-1",
        ]);

        expect(unit.data.previewSrc).toBe("data:image/png;base64,PREVIEW");
        expect(unit.data.annotationState?.elements.map((item) => item.id)).toEqual([
            "shape-1",
            "text-1",
            "mosaic-1",
        ]);
        expect(unit.data.imageEditState?.cropRect).toEqual({ x: 5, y: 6, w: 160, h: 90 });
    });

    it("can rasterize every control into the annotation layer while preserving counters", () => {
        const unit = makeUnit();
        const ids = getRasterizableAnnotationIds(unit, "all", null);
        const patch = createRasterizedStickerData(
            unit,
            {
                baseLayerSrc: "data:image/png;base64,BASE",
                rasterizedAnnotationLayerSrc: "data:image/png;base64,ALL_ANNOTATIONS",
                previewSrc: "data:image/png;base64,FINAL",
            },
            ids,
        );

        expect(patch.annotationState).toEqual({
            serialCounter: 7,
            elements: [],
        });
        expect(patch.rasterizedAnnotationLayerSrc).toBe("data:image/png;base64,ALL_ANNOTATIONS");
    });
});
