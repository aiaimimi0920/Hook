import { createStore } from "solid-js/store";
import { describe, expect, it } from "vitest";

import {
    captureStickerEditSnapshot,
    createEmptyStickerHistory,
    pushStickerHistorySnapshot,
    redoStickerHistorySnapshot,
    undoStickerHistorySnapshot,
    type StickerEditSnapshot,
} from "../../src/services/stickerHistory";
import type { Unit } from "../../src/types/unit";

const makeSnapshot = (overrides?: Partial<StickerEditSnapshot>): StickerEditSnapshot => ({
    unitRect: { x: 10, y: 20, w: 200, h: 120 },
    annotationState: {
        elements: [],
        serialCounter: 1,
    },
    imageEditState: {
        contentEraseStrokes: [],
        flippedX: false,
        flippedY: false,
        cornerRadius: 12,
    },
    ...overrides,
});

describe("stickerHistory", () => {
    it("captures snapshots from store-backed cropped stickers without clone errors", () => {
        const [units] = createStore<Unit[]>([
            {
                id: "sticker-1",
                type: "sticker",
                x: 140,
                y: 130,
                w: 120,
                h: 80,
                data: {
                    src: "test.png",
                    imageEditState: {
                        contentEraseStrokes: [],
                        cropRect: { x: 40, y: 20, w: 120, h: 80 },
                        sourceSize: { w: 300, h: 200 },
                    },
                    annotationState: {
                        elements: [],
                        serialCounter: 1,
                    },
                },
                params: {},
                inputs: [],
                outputs: [],
            },
        ]);

        expect(() => captureStickerEditSnapshot(units[0])).not.toThrow();
        const snapshot = captureStickerEditSnapshot(units[0]);
        expect(snapshot.unitRect).toEqual({ x: 140, y: 130, w: 120, h: 80 });
        expect(snapshot.imageEditState.cropRect).toEqual({ x: 40, y: 20, w: 120, h: 80 });
        expect(snapshot.imageEditState.sourceSize).toEqual({ w: 300, h: 200 });
    });

    it("captures image source data only when requested for rasterization undo and redo", () => {
        const unit: Unit = {
            id: "sticker-1",
            type: "sticker",
            x: 140,
            y: 130,
            w: 120,
            h: 80,
            data: {
                src: "data:image/png;base64,ORIGINAL",
                previewSrc: "data:image/png;base64,PREVIEW",
                resultHandle: "old-handle",
                filePath: "C:/tmp/old.png",
                rasterizedAnnotationLayerSrc: "data:image/png;base64,LAYER",
                imageEditState: {
                    contentEraseStrokes: [],
                },
                annotationState: {
                    elements: [],
                    serialCounter: 1,
                },
            },
            params: {},
            inputs: [],
            outputs: [],
        };

        expect(captureStickerEditSnapshot(unit).imageData).toBeUndefined();
        expect(captureStickerEditSnapshot(unit, { includeImageData: true }).imageData).toEqual({
            src: "data:image/png;base64,ORIGINAL",
            previewSrc: "data:image/png;base64,PREVIEW",
            resultHandle: "old-handle",
            filePath: "C:/tmp/old.png",
            rasterizedAnnotationLayerSrc: "data:image/png;base64,LAYER",
        });
    });

    it("pushes immutable snapshots into undo history and clears redo history", () => {
        const history = createEmptyStickerHistory();
        const previous = makeSnapshot();
        const withRedo = {
            ...history,
            future: [makeSnapshot({ unitRect: { x: 99, y: 88, w: 50, h: 40 } })],
        };

        const next = pushStickerHistorySnapshot(withRedo, previous);

        expect(next.past).toHaveLength(1);
        expect(next.future).toHaveLength(0);

        previous.unitRect.x = 777;
        expect(next.past[0].unitRect.x).toBe(10);
    });

    it("undo returns the previous snapshot and pushes the current snapshot into redo history", () => {
        const before = makeSnapshot();
        const current = makeSnapshot({ unitRect: { x: 40, y: 50, w: 90, h: 60 } });
        const history = pushStickerHistorySnapshot(createEmptyStickerHistory(), before);

        const result = undoStickerHistorySnapshot(history, current);

        expect(result.snapshot?.unitRect).toEqual(before.unitRect);
        expect(result.history.past).toHaveLength(0);
        expect(result.history.future).toHaveLength(1);
        expect(result.history.future[0].unitRect).toEqual(current.unitRect);
    });

    it("redo restores the most recent undone snapshot and preserves immutability", () => {
        const initial = makeSnapshot();
        const current = makeSnapshot({ unitRect: { x: 40, y: 50, w: 90, h: 60 } });
        const history = pushStickerHistorySnapshot(createEmptyStickerHistory(), initial);
        const undone = undoStickerHistorySnapshot(history, current);

        const redone = redoStickerHistorySnapshot(undone.history, initial);

        expect(redone.snapshot?.unitRect).toEqual(current.unitRect);
        expect(redone.history.future).toHaveLength(0);
        expect(redone.history.past).toHaveLength(1);
        expect(redone.history.past[0].unitRect).toEqual(initial.unitRect);
    });
});
