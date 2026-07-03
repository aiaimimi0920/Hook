import { describe, expect, it } from "vitest";

import { moveLineEndpoint } from "../../src/services/stickerGeometry";
import type { StickerAnnotation } from "../../src/types/stickerEditing";

const makeLine = (type: StickerAnnotation["type"] = "line"): StickerAnnotation => ({
    id: "line-1",
    type: type as "line",
    zIndex: 1,
    points: [
        { x: 20, y: 30 },
        { x: 90, y: 120 },
    ],
    style: { color: "#fff", width: 3, opacity: 1 },
} as StickerAnnotation);

describe("sticker line handle helpers", () => {
    it("moves only the requested endpoint for line-like annotations", () => {
        const source = makeLine("arrow");

        expect(moveLineEndpoint(source, "start", { x: 10, y: 15 })).toMatchObject({
            points: [
                { x: 10, y: 15 },
                { x: 90, y: 120 },
            ],
        });

        expect(moveLineEndpoint(source, "end", { x: 110, y: 160 })).toMatchObject({
            points: [
                { x: 20, y: 30 },
                { x: 110, y: 160 },
            ],
        });
    });

    it("does not mutate the original annotation points", () => {
        const source = makeLine("polyline");
        const moved = moveLineEndpoint(source, "end", { x: 77, y: 88 });

        expect(source.points).toEqual([
            { x: 20, y: 30 },
            { x: 90, y: 120 },
        ]);
        expect(moved.points).toEqual([
            { x: 20, y: 30 },
            { x: 77, y: 88 },
        ]);
    });
});
