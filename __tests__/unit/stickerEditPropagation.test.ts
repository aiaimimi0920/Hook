import { describe, expect, it } from "vitest";

import {
    buildStickerEditPropagationPatches,
    resolveStickerContentFrame,
} from "../../src/services/stickerEditPropagation";
import type { Link, Unit } from "../../src/types/unit";

const sticker = (
    id: string,
    w: number,
    h: number,
    data: Unit["data"] = {},
): Unit => ({
    id,
    type: "sticker",
    x: 0,
    y: 0,
    w,
    h,
    data,
    params: {},
    inputs: [{ id: "image", type: "image", direction: "input" }],
    outputs: [{ id: "output_image", type: "image", direction: "output" }],
});

const link = (id: string, fromUnitId: string, toUnitId: string): Link => ({
    id,
    fromUnitId,
    fromPortId: "output_image",
    toUnitId,
    toPortId: "image",
});

const applyPatch = (unit: Unit, patch: ReturnType<typeof buildStickerEditPropagationPatches>[number]) => ({
    ...unit,
    data: { ...unit.data, ...patch.data },
});

describe("sticker edit propagation sizing", () => {
    it("passes the original source through untouched intermediate stickers", () => {
        const a = sticker("a", 100, 100);
        const b = sticker("b", 100, 200);
        const c = sticker("c", 200, 200);
        const patches = buildStickerEditPropagationPatches({
            units: [a, b, c],
            links: [link("a-b", "a", "b"), link("b-c", "b", "c")],
            sourceUnitId: "a",
        });

        const bPatch = patches.find((patch) => patch.unitId === "b");
        const cPatch = patches.find((patch) => patch.unitId === "c");
        expect(bPatch).toBeDefined();
        expect(cPatch).toBeDefined();
        expect(resolveStickerContentFrame(applyPatch(b, bPatch!))).toEqual({
            x: 0,
            y: 50,
            w: 100,
            h: 100,
        });
        expect(cPatch!.data.stickerEditPropagation).toMatchObject({
            upstreamSourceUnitId: "a",
            upstreamSourceFrame: { w: 100, h: 100 },
            upstreamContentFrame: { x: 0, y: 0, w: 100, h: 100 },
        });
        expect(resolveStickerContentFrame(applyPatch(c, cPatch!))).toEqual({
            x: 0,
            y: 0,
            w: 200,
            h: 200,
        });
    });

    it("keeps A as the effective source when B -> C is linked after A -> B", () => {
        const a = sticker("a", 100, 100);
        const b = sticker("b", 100, 200);
        const c = sticker("c", 200, 200);
        const aToB = link("a-b", "a", "b");
        const bToC = link("b-c", "b", "c");

        const [bPatch] = buildStickerEditPropagationPatches({
            units: [a, b, c],
            links: [aToB],
            sourceUnitId: "a",
        });
        const propagatedB = applyPatch(b, bPatch);
        const [cPatch] = buildStickerEditPropagationPatches({
            units: [a, propagatedB, c],
            links: [aToB, bToC],
            sourceUnitId: "b",
        });

        expect(cPatch.data.stickerEditPropagation).toMatchObject({
            locallyEdited: false,
            upstreamSourceUnitId: "a",
            upstreamSourceFrame: { w: 100, h: 100 },
            upstreamContentFrame: { x: 0, y: 0, w: 100, h: 100 },
        });
        expect(resolveStickerContentFrame(applyPatch(c, cPatch))).toEqual({
            x: 0,
            y: 0,
            w: 200,
            h: 200,
        });
    });

    it("uses an edited intermediate sticker as the new propagation boundary", () => {
        const b = sticker("b", 100, 200, {
            stickerEditPropagation: {
                locallyEdited: true,
                revision: 3,
                upstreamSourceUnitId: "a",
                upstreamSourceRevision: 1,
                upstreamSourceFrame: { w: 100, h: 100 },
                upstreamContentFrame: { x: 0, y: 0, w: 100, h: 100 },
            },
        });
        const c = sticker("c", 200, 200);
        const [cPatch] = buildStickerEditPropagationPatches({
            units: [b, c],
            links: [link("b-c", "b", "c")],
            sourceUnitId: "b",
        });

        expect(cPatch.data.stickerEditPropagation).toMatchObject({
            upstreamSourceUnitId: "b",
            upstreamSourceRevision: 3,
            upstreamSourceFrame: { w: 100, h: 200 },
            upstreamContentFrame: { x: 0, y: 50, w: 100, h: 100 },
        });
        expect(resolveStickerContentFrame(applyPatch(c, cPatch))).toEqual({
            x: 50,
            y: 50,
            w: 100,
            h: 100,
        });
    });
});
