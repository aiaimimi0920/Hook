import { describe, expect, it } from "vitest";
import type { Unit } from "../../src/types/unit";
import {
    createStickerAsyncEditGuard,
    isStickerAsyncEditGuardCurrent,
} from "../../src/services/stickerAsyncEditGuard";

const createUnit = (): Unit => ({
    id: "sticker-1",
    type: "sticker",
    x: 1,
    y: 2,
    w: 100,
    h: 80,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        src: "source",
        annotationState: { elements: [], serialCounter: 0 },
        imageEditState: { contentEraseStrokes: [] },
    },
});

describe("sticker async edit guard", () => {
    it("accepts an equivalent current unit without cloning image payload strings", () => {
        const unit = createUnit();
        const guard = createStickerAsyncEditGuard(unit);
        const equivalent = structuredClone(unit);

        expect(isStickerAsyncEditGuardCurrent(guard, equivalent)).toBe(true);
        expect(guard.source.src).toBe(unit.data.src);
    });

    it("rejects deletion, geometry changes, source changes, and editable-state changes", () => {
        const unit = createUnit();
        const guard = createStickerAsyncEditGuard(unit);

        expect(isStickerAsyncEditGuardCurrent(guard, undefined)).toBe(false);
        expect(isStickerAsyncEditGuardCurrent(guard, { ...unit, w: 101 })).toBe(false);
        expect(isStickerAsyncEditGuardCurrent(guard, { ...unit, data: { ...unit.data, src: "new" } })).toBe(false);
        expect(isStickerAsyncEditGuardCurrent(guard, {
            ...unit,
            data: {
                ...unit.data,
                imageEditState: { contentEraseStrokes: [], cornerRadius: 4 },
            },
        })).toBe(false);
    });
});
