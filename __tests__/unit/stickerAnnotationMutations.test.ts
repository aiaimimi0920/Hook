import { describe, expect, it } from "vitest";

import {
    removeAnnotationById,
    updateTextAnnotationFontFamilyById,
    updateTextAnnotationById,
} from "../../src/services/stickerAnnotationMutations";
import type { StickerAnnotationState } from "../../src/types/stickerEditing";

const makeState = (): StickerAnnotationState => ({
    serialCounter: 2,
    elements: [
        {
            id: "text-1",
            type: "text",
            zIndex: 1,
            x: 30,
            y: 40,
            text: "before",
            style: { color: "#fff", width: 2, opacity: 1 },
        },
        {
            id: "shape-1",
            type: "rect",
            zIndex: 2,
            x: 20,
            y: 20,
            w: 100,
            h: 50,
            style: { color: "#fff", width: 2, opacity: 1 },
        },
    ],
});

describe("stickerAnnotationMutations", () => {
    it("removes the requested annotation without mutating the original state", () => {
        const state = makeState();
        const next = removeAnnotationById(state, "shape-1");

        expect(next.elements.map((item) => item.id)).toEqual(["text-1"]);
        expect(state.elements.map((item) => item.id)).toEqual(["text-1", "shape-1"]);
    });

    it("updates text annotations in place while leaving non-text annotations untouched", () => {
        const state = makeState();
        const next = updateTextAnnotationById(state, "text-1", "after");

        expect(next.elements[0]).toMatchObject({
            id: "text-1",
            text: "after",
        });
        expect(next.elements[1]).toEqual(state.elements[1]);
        expect(state.elements[0]).toMatchObject({ text: "before" });
    });

    it("ignores empty updates and unknown ids", () => {
        const state = makeState();

        expect(updateTextAnnotationById(state, "text-1", "   ")).toEqual(state);
        expect(updateTextAnnotationById(state, "missing", "after")).toEqual(state);
    });

    it("updates text font family in place while leaving non-text annotations untouched", () => {
        const state = makeState();
        const next = updateTextAnnotationFontFamilyById(state, "text-1", "微软雅黑");

        expect(next.elements[0]).toMatchObject({
            id: "text-1",
            fontFamily: "微软雅黑",
        });
        expect(next.elements[1]).toEqual(state.elements[1]);
        expect(updateTextAnnotationFontFamilyById(state, "missing", "微软雅黑")).toEqual(state);
    });
});
