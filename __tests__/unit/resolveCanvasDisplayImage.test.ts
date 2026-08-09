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

    it("9. ignores a cached sticker preview while relaying an upstream image", () => {
        const units = [
            mkUnit({
                id: "target",
                inputs: [{ id: "image", type: "image", direction: "input" }],
                data: { previewSrc: "PREVIEW", src: "TARGET_SRC" },
            }),
            mkUnit({ id: "up", data: { src: "UP_SRC" } }),
        ];
        const links = [imageLink("up", "target", "image")];

        expect(resolveCanvasDisplayImage({ units, links, unitId: "target" })).toBe("UP_SRC");
        expect(resolveUnitImageFromGraph({ units, links, unitId: "target" })).toBe("UP_SRC");
    });

    it("10. passes A through untouched B and C despite differently sized cached previews", () => {
        const units = [
            mkUnit({
                id: "A",
                w: 100,
                h: 100,
                data: { previewSrc: "A_100x100", src: "A_SOURCE" },
            }),
            mkUnit({
                id: "B",
                w: 100,
                h: 200,
                data: {
                    previewSrc: "B_CONTAINED_100x200",
                    stickerEditPropagation: { locallyEdited: false },
                },
            }),
            mkUnit({
                id: "C",
                w: 200,
                h: 200,
                data: {
                    previewSrc: "C_CONTAINED_200x200",
                    stickerEditPropagation: { locallyEdited: false },
                },
            }),
        ];
        const links = [imageLink("A", "B"), imageLink("B", "C")];

        expect(resolveCanvasDisplayImage({ units, links, unitId: "C" })).toBe("A_100x100");
    });

    it("11. keeps an edited B preview as the boundary for downstream C", () => {
        const units = [
            mkUnit({ id: "A", w: 100, h: 100, data: { previewSrc: "A_100x100" } }),
            mkUnit({
                id: "B",
                w: 100,
                h: 200,
                data: {
                    previewSrc: "B_EDITED_100x200",
                    stickerEditPropagation: { locallyEdited: true },
                },
            }),
            mkUnit({
                id: "C",
                w: 200,
                h: 200,
                data: { previewSrc: "C_STALE", stickerEditPropagation: { locallyEdited: false } },
            }),
        ];
        const links = [imageLink("A", "B"), imageLink("B", "C")];

        expect(resolveCanvasDisplayImage({ units, links, unitId: "C" })).toBe("B_EDITED_100x200");
    });

    it("12. displays a workflow Art's formal output downstream instead of its shader preview", () => {
        const units = [
            mkUnit({
                id: "workflow-art",
                type: "art",
                artId: "hook-wf-color-transfer-compress",
                outputs: [{ id: "output", type: "image", direction: "output" }],
                data: {
                    previewSrc: "SHADER_PREVIEW",
                    outputs: { output: "COMPRESSED_FORMAL" },
                },
            }),
            mkUnit({ id: "target", data: { src: "TARGET_ORIGINAL" } }),
        ];
        const links = [imageLink("workflow-art", "target")];

        expect(resolveCanvasDisplayImage({ units, links, unitId: "workflow-art" })).toBe("SHADER_PREVIEW");
        expect(resolveCanvasDisplayImage({ units, links, unitId: "target" })).toBe("COMPRESSED_FORMAL");
        expect(resolveUnitImageFromGraph({ units, links, unitId: "target" })).toBe("COMPRESSED_FORMAL");
    });

    it("13. does not leak an Art preview downstream before a formal output exists", () => {
        const units = [
            mkUnit({
                id: "workflow-art",
                type: "art",
                artId: "hook-wf-color-transfer-compress",
                outputs: [{ id: "output", type: "image", direction: "output" }],
                data: { previewSrc: "SHADER_PREVIEW" },
            }),
            mkUnit({
                id: "target",
                data: { previewSrc: "LAST_FORMAL", src: "TARGET_ORIGINAL" },
            }),
        ];
        const links = [imageLink("workflow-art", "target")];

        expect(resolveCanvasDisplayImage({ units, links, unitId: "target" })).toBe("LAST_FORMAL");
        expect(resolveUnitImageFromGraph({ units, links, unitId: "target" })).toBe("LAST_FORMAL");
    });
});
