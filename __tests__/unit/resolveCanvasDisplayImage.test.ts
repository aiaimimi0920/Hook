import { describe, expect, it } from "vitest";

import {
    resolveCanvasDisplayImage,
    resolveUnitImageFromGraph,
} from "../../src/services/graphImageResolution";
import type { Link, Unit } from "../../src/types/unit";

const mkUnit = (over: Partial<Unit> & { id: string }): Unit => ({
    type: "sticker",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    params: {},
    inputs: [],
    outputs: [],
    data: {},
    ...over,
});

const imageLink = (fromUnitId: string, toUnitId: string, toPortId = "image"): Link => ({
    id: `${fromUnitId}->${toUnitId}:${toPortId}`,
    fromUnitId,
    fromPortId: "output",
    toUnitId,
    toPortId,
});

describe("resolveCanvasDisplayImage", () => {
    it("1. returns the node's own previewSrc first, even for a sticker", () => {
        const units = [mkUnit({ id: "a", data: { previewSrc: "P", src: "S" } })];
        expect(resolveCanvasDisplayImage({ units, links: [], unitId: "a" })).toBe("P");
    });

    it("2. resolves an upstream image connected on an accepted input port", () => {
        const units = [
            mkUnit({ id: "target", data: { src: "TS" } }),
            mkUnit({ id: "up", data: { src: "US" } }),
        ];
        const links = [imageLink("up", "target", "image")];
        expect(resolveCanvasDisplayImage({ units, links, unitId: "target" })).toBe("US");
    });

    it("3. ignores links on ports outside image/input_image/input", () => {
        const units = [
            mkUnit({ id: "target", data: { src: "TS" } }),
            mkUnit({ id: "up", data: { src: "US" } }),
        ];
        const links = [imageLink("up", "target", "mask")];
        expect(resolveCanvasDisplayImage({ units, links, unitId: "target" })).toBe("TS");
    });

    it("4. falls back to the node's own src when there is no preview and no link", () => {
        const units = [mkUnit({ id: "a", data: { src: "S" } })];
        expect(resolveCanvasDisplayImage({ units, links: [], unitId: "a" })).toBe("S");
    });

    it("5. returns undefined for an unknown unit id", () => {
        expect(resolveCanvasDisplayImage({ units: [], links: [], unitId: "ghost" })).toBeUndefined();
    });

    it("6. survives a link cycle (A -> B -> A) without infinite recursion", () => {
        const units = [mkUnit({ id: "A", data: {} }), mkUnit({ id: "B", data: {} })];
        const links = [imageLink("B", "A", "image"), imageLink("A", "B", "image")];
        expect(() =>
            resolveCanvasDisplayImage({ units, links, unitId: "A" }),
        ).not.toThrow();
        expect(resolveCanvasDisplayImage({ units, links, unitId: "A" })).toBeUndefined();
    });

    it("7. resolves through a multi-hop chain A -> B -> C", () => {
        const units = [
            mkUnit({ id: "A", data: {} }),
            mkUnit({ id: "B", data: {} }),
            mkUnit({ id: "C", data: { src: "CS" } }),
        ];
        const links = [imageLink("B", "A", "image"), imageLink("C", "B", "image")];
        expect(resolveCanvasDisplayImage({ units, links, unitId: "A" })).toBe("CS");
    });

    it("8. falls back to its own src when the upstream resolves to nothing", () => {
        const units = [
            mkUnit({ id: "A", data: { src: "AS" } }),
            mkUnit({ id: "B", data: {} }), // no preview, no src, no upstream
        ];
        const links = [imageLink("B", "A", "image")];
        expect(resolveCanvasDisplayImage({ units, links, unitId: "A" })).toBe("AS");
    });

    it("9. DIVERGES from resolveUnitImageFromGraph for a sticker with both previewSrc and an upstream", () => {
        // Same graph, two resolvers. The canvas resolver prefers the node's own
        // previewSrc; the capability-aware graph resolver prefers the upstream
        // image for stickers. This pins the intentional behavioral difference.
        const units = [
            mkUnit({
                id: "target",
                inputs: [{ id: "image", type: "image", direction: "input" }],
                data: { previewSrc: "PREVIEW", src: "TARGET_SRC" },
            }),
            mkUnit({ id: "up", data: { src: "UP_SRC" } }),
        ];
        const links = [imageLink("up", "target", "image")];

        expect(resolveCanvasDisplayImage({ units, links, unitId: "target" })).toBe("PREVIEW");
        expect(resolveUnitImageFromGraph({ units, links, unitId: "target" })).toBe("UP_SRC");
    });
});
