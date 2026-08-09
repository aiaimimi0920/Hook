import { afterEach, describe, expect, it } from "vitest";

import { resolveStickerContentFrame } from "../../src/services/stickerEditPropagation";
import { resolveCanvasDisplayImage } from "../../src/services/graphImageResolution";
import { graphStore } from "../../src/store/graphStore";
import type { Link, Unit } from "../../src/types/unit";

const sticker = (id: string, w: number, h: number): Unit => ({
    id,
    type: "sticker",
    x: 0,
    y: 0,
    w,
    h,
    data: { previewSrc: `${id}_${w}x${h}` },
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

describe("sticker pass-through graph lifecycle", () => {
    afterEach(() => {
        graphStore.actions.replaceUnits([]);
        graphStore.setLinks([]);
        graphStore.setUnitParams({});
        graphStore.setUnitExecConfig({});
    });

    it("preserves A as the source when links are added incrementally", () => {
        graphStore.actions.replaceUnits([
            sticker("a", 100, 100),
            sticker("b", 100, 200),
            sticker("c", 200, 200),
        ]);

        graphStore.actions.addLink(link("a-b", "a", "b"));
        graphStore.actions.addLink(link("b-c", "b", "c"));

        const c = graphStore.units.find((unit) => unit.id === "c");
        expect(c?.data.stickerEditPropagation).toMatchObject({
            locallyEdited: false,
            upstreamSourceUnitId: "a",
            upstreamSourceFrame: { w: 100, h: 100 },
        });
        expect(resolveStickerContentFrame(c!)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
        expect(
            resolveCanvasDisplayImage({
                units: graphStore.units,
                links: graphStore.links,
                unitId: "c",
            }),
        ).toBe("a_100x100");
    });

    it("repairs stale relay metadata after loading a saved graph", () => {
        const a = sticker("a", 100, 100);
        const b = sticker("b", 100, 200);
        b.data.stickerEditPropagation = {
            locallyEdited: false,
            upstreamSourceUnitId: "a",
            upstreamSourceFrame: { w: 100, h: 100 },
            upstreamContentFrame: { x: 0, y: 0, w: 100, h: 100 },
        };
        const c = sticker("c", 200, 200);
        c.data.stickerEditPropagation = {
            locallyEdited: false,
            upstreamSourceUnitId: "b",
            upstreamSourceFrame: { w: 100, h: 200 },
            upstreamContentFrame: { x: 0, y: 50, w: 100, h: 100 },
        };

        graphStore.actions.replaceUnits([a, b, c]);
        graphStore.setLinks([link("a-b", "a", "b"), link("b-c", "b", "c")]);
        graphStore.actions.reconcileStickerEditPropagation();

        const repairedC = graphStore.units.find((unit) => unit.id === "c");
        expect(repairedC?.data.stickerEditPropagation?.upstreamSourceUnitId).toBe("a");
        expect(resolveStickerContentFrame(repairedC!)).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    });
});
