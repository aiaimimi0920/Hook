import { describe, expect, it } from "vitest";

import {
    buildPolygonPoints,
    findTopmostAnnotationAtPoint,
    getAnnotationBounds,
    getAnnotationGroupBounds,
} from "../../src/services/stickerGeometry";
import type { StickerAnnotation } from "../../src/types/stickerEditing";

const LARGE_INPUT_SIZE = 150_000;

describe("sticker geometry hardening", () => {
    it("bounds polygon allocation for non-finite and out-of-range side counts", () => {
        const box = { x: 0, y: 0, w: 100, h: 80 };

        expect(buildPolygonPoints(box, Number.NaN)).toHaveLength(3);
        expect(buildPolygonPoints(box, Number.POSITIVE_INFINITY)).toHaveLength(3);
        expect(buildPolygonPoints(box, Number.MAX_SAFE_INTEGER)).toHaveLength(12);
    });

    it("computes bounds for point clouds larger than the JavaScript argument limit", () => {
        const line: StickerAnnotation = {
            id: "large-line",
            type: "line",
            zIndex: 1,
            points: Array.from({ length: LARGE_INPUT_SIZE }, (_, index) => ({
                x: index,
                y: index % 10,
            })),
            style: { color: "#fff", width: 2, opacity: 1 },
        };

        expect(getAnnotationBounds(line)).toEqual({
            x: -1,
            y: -1,
            w: LARGE_INPUT_SIZE + 1,
            h: 11,
        });
    });

    it("combines annotation groups larger than the JavaScript argument limit", () => {
        const annotation: StickerAnnotation = {
            id: "shared-rect",
            type: "rect",
            zIndex: 1,
            x: 10,
            y: 20,
            w: 30,
            h: 40,
            style: { color: "#fff", width: 2, opacity: 1 },
        };
        const annotations = new Array<StickerAnnotation>(LARGE_INPUT_SIZE).fill(annotation);

        expect(getAnnotationGroupBounds(annotations)).toEqual({
            x: 10,
            y: 20,
            w: 30,
            h: 40,
        });
    });

    it("keeps topmost hit ordering stable without mutating the caller array", () => {
        const first: StickerAnnotation = {
            id: "first-equal-z",
            type: "rect",
            zIndex: 5,
            x: 0,
            y: 0,
            w: 40,
            h: 40,
            style: { color: "#fff", width: 2, opacity: 1, fill: "#fff" },
        };
        const lower: StickerAnnotation = {
            ...first,
            id: "lower-z",
            zIndex: 1,
        };
        const second: StickerAnnotation = {
            ...first,
            id: "second-equal-z",
        };
        const annotations = [first, lower, second];
        const originalOrder = annotations.map((annotation) => annotation.id);

        expect(findTopmostAnnotationAtPoint(annotations, { x: 20, y: 20 }, 0)?.id).toBe(first.id);
        expect(annotations.map((annotation) => annotation.id)).toEqual(originalOrder);
    });
});
