import { describe, expect, it } from "vitest";

import {
    resizeBoxAnnotation,
    type ResizeHandle,
} from "../../src/services/stickerGeometry";
import type { StickerAnnotation } from "../../src/types/stickerEditing";

const makeBox = (type: StickerAnnotation["type"] = "rect"): StickerAnnotation => ({
    id: "box",
    type: type as "rect",
    zIndex: 1,
    x: 40,
    y: 50,
    w: 120,
    h: 80,
    style: { color: "#fff", width: 2, opacity: 1 },
} as StickerAnnotation);

describe("sticker annotation resize helpers", () => {
    const handles: ResizeHandle[] = ["nw", "ne", "sw", "se"];

    it("resizes box-like annotations from every corner handle", () => {
        const source = makeBox("mosaic");
        const expected = {
            nw: { x: 20, y: 30, w: 140, h: 100 },
            ne: { x: 40, y: 20, w: 160, h: 110 },
            sw: { x: 10, y: 50, w: 150, h: 120 },
            se: { x: 40, y: 50, w: 170, h: 130 },
        } satisfies Record<ResizeHandle, { x: number; y: number; w: number; h: number }>;

        const points = {
            nw: { x: 20, y: 30 },
            ne: { x: 200, y: 20 },
            sw: { x: 10, y: 170 },
            se: { x: 210, y: 180 },
        } satisfies Record<ResizeHandle, { x: number; y: number }>;

        for (const handle of handles) {
            expect(resizeBoxAnnotation(source, handle, points[handle])).toMatchObject(expected[handle]);
        }
    });

    it("enforces a minimum size without mutating the original annotation", () => {
        const source = makeBox("ellipse");
        const resized = resizeBoxAnnotation(source, "nw", { x: 400, y: 400 }, 24);

        expect(resized).toMatchObject({
            x: 136,
            y: 106,
            w: 24,
            h: 24,
        });
        expect(source).toMatchObject({
            x: 40,
            y: 50,
            w: 120,
            h: 80,
        });
    });
});
