import { describe, expect, it } from "vitest";

import { duplicateAnnotationById } from "../../src/services/stickerAnnotationMutations";
import type { StickerAnnotationState } from "../../src/types/stickerEditing";

const makeState = (): StickerAnnotationState => ({
    serialCounter: 2,
    elements: [
        {
            id: "line-1",
            type: "arrow",
            zIndex: 1,
            points: [
                { x: 10, y: 20 },
                { x: 30, y: 50 },
            ],
            style: { color: "#fff", width: 2, opacity: 1 },
        },
        {
            id: "text-1",
            type: "text",
            zIndex: 2,
            x: 40,
            y: 60,
            text: "hello",
            fontSize: 18,
            style: { color: "#fff", width: 2, opacity: 1 },
        },
    ],
});

describe("sticker annotation copy helper", () => {
    it("duplicates line-like annotations with a positional offset", () => {
        const state = makeState();
        const next = duplicateAnnotationById(state, "line-1", 12, 8);

        expect(next.elements).toHaveLength(3);
        expect(next.createdAnnotationId).toBeTruthy();
        expect(next.elements[2]).toMatchObject({
            type: "arrow",
            zIndex: 3,
            points: [
                { x: 22, y: 28 },
                { x: 42, y: 58 },
            ],
        });
    });

    it("duplicates text annotations without mutating the source state", () => {
        const state = makeState();
        const next = duplicateAnnotationById(state, "text-1", 10, 6);

        expect(next.elements[2]).toMatchObject({
            type: "text",
            text: "hello",
            x: 50,
            y: 66,
            fontSize: 18,
        });
        expect(state.elements).toHaveLength(2);
    });
});
