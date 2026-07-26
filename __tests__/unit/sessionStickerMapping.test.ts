import { describe, expect, it } from "vitest";

import {
    detectUnknownSessionStickerKeys,
    mapSessionStickerToUnit,
} from "../../src/services/sessionStickerMapping";
import { mapUnitToSessionSticker } from "../../src/services/sessionStickerPayload";
import type { ArtCapability } from "../../src/services/protocol";
import type { SessionSticker, Unit } from "../../src/types/unit";

// A capability with one image input and one custom-named output, used to prove
// that art-node ports are synthesized from the injected capability list.
const BLUR_CAPABILITY = {
    id: "blur",
    label: "Blur",
    inputs: [{ name: "input_image", label: "In", type: "image" }],
    outputs: [{ name: "result", label: "Result", type: "image" }],
    params: [],
} as unknown as ArtCapability;

const noCaps = { capabilities: [] as ArtCapability[] };

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

describe("mapSessionStickerToUnit", () => {
    it("1. maps every field of a fully-populated sticker", () => {
        const sticker: SessionSticker = {
            id: "s1",
            type: "sticker",
            x: 10,
            y: 20,
            w: 100,
            h: 80,
            src: "data:img",
            previewSrc: "data:preview",
            minified: true,
            savedRect: { x: 1, y: 2, w: 3, h: 4 },
            cropOffset: { x: 5, y: 6 },
            opacityNormal: 0.5,
            opacityMini: 0.3,
            params: { blur: 2 },
            filePath: "/tmp/a.png",
            rasterizedAnnotationLayerSrc: "data:anno",
            outputs: { out: 1 },
            originWorkflowId: "wf",
            originNodeId: "n1",
            executionConfig: {
                triggerMode: { upstreamDriven: false, paramDriven: false },
                propagation: { listenUpstream: false, notifyDownstream: false },
            },
            groupId: "g1",
            captureMeta: { source: "region" } as SessionSticker["captureMeta"],
        };

        const unit = mapSessionStickerToUnit(sticker, noCaps);

        expect(unit.id).toBe("s1");
        expect(unit.type).toBe("sticker");
        expect(unit.x).toBe(10);
        expect(unit.y).toBe(20);
        expect(unit.w).toBe(100);
        expect(unit.h).toBe(80);
        expect(unit.params).toEqual({ blur: 2 });
        expect(unit.data.src).toBe("data:img");
        expect(unit.data.minified).toBe(true);
        expect(unit.data.savedRect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
        expect(unit.data.cropOffset).toEqual({ x: 5, y: 6 });
        expect(unit.data.opacityNormal).toBe(0.5);
        expect(unit.data.opacityMini).toBe(0.3);
        expect(unit.data.previewSrc).toBe("data:preview");
        expect(unit.data.filePath).toBe("/tmp/a.png");
        expect(unit.data.rasterizedAnnotationLayerSrc).toBe("data:anno");
        expect(unit.data.outputs).toEqual({ out: 1 });
        expect(unit.data.originWorkflowId).toBe("wf");
        expect(unit.data.originNodeId).toBe("n1");
        expect(unit.data.groupId).toBe("g1");
        expect(unit.data.captureMeta).toEqual({ source: "region" });
        // Explicit config is honored (cloned), not replaced by defaults.
        expect(unit.data.executionConfig).toEqual({
            triggerMode: { upstreamDriven: false, paramDriven: false },
            propagation: { listenUpstream: false, notifyDownstream: false },
        });
    });

    it("2. applies load-bearing defaults for a minimal sticker", () => {
        const sticker: SessionSticker = { id: "m", x: 0, y: 0, w: 10, h: 10 };

        const unit = mapSessionStickerToUnit(sticker, noCaps);

        expect(unit.type).toBe("sticker");
        expect(unit.data.minified).toBe(false);
        expect(unit.data.opacityNormal).toBe(1);
        expect(unit.data.opacityMini).toBe(0.9);
        expect(unit.data.src).toBeUndefined();
        expect(unit.data.previewSrc).toBeUndefined();
        expect(unit.data.filePath).toBeUndefined();
        expect(unit.data.savedRect).toBeUndefined();
        expect(unit.data.cropOffset).toBeUndefined();
        expect(unit.data.annotationState).toBeUndefined();
        expect(unit.artId).toBeUndefined();
        expect(unit.params).toEqual({});
        // A full default execution config is always synthesized, even for stickers.
        expect(unit.data.executionConfig).toBeDefined();
    });

    it("3. infers an art unit from type and falls back to default art ports without a capability", () => {
        const sticker: SessionSticker = { id: "a", type: "art", x: 0, y: 0, w: 1, h: 1 };

        const unit = mapSessionStickerToUnit(sticker, noCaps);

        expect(unit.type).toBe("art");
        expect(unit.artId).toBeUndefined();
        expect(unit.inputs).toEqual([
            { id: "input_image", label: "Input", type: "image", direction: "input" },
        ]);
        expect(unit.outputs).toEqual([
            { id: "output_image", label: "Image", type: "image", direction: "output" },
        ]);
    });

    it("4. synthesizes default sticker ports when there is no artId", () => {
        const unit = mapSessionStickerToUnit({ id: "m", x: 0, y: 0, w: 10, h: 10 }, noCaps);

        expect(unit.inputs).toEqual([
            { id: "image", type: "image", direction: "input", label: "Image" },
        ]);
        expect(unit.outputs).toEqual([
            { id: "output_image", type: "image", direction: "output", label: "Image" },
        ]);
    });

    it("5. drops previewSrc when it is identical to src", () => {
        const unit = mapSessionStickerToUnit(
            { id: "p", x: 0, y: 0, w: 1, h: 1, src: "same", previewSrc: "same" },
            noCaps,
        );
        expect(unit.data.previewSrc).toBeUndefined();
    });

    it("6. keeps previewSrc when it differs from src", () => {
        const unit = mapSessionStickerToUnit(
            { id: "p", x: 0, y: 0, w: 1, h: 1, src: "a", previewSrc: "b" },
            noCaps,
        );
        expect(unit.data.previewSrc).toBe("b");
    });

    it("7. distinguishes explicit minified false/true from a missing value", () => {
        const falseUnit = mapSessionStickerToUnit(
            { id: "f", x: 0, y: 0, w: 1, h: 1, minified: false },
            noCaps,
        );
        const trueUnit = mapSessionStickerToUnit(
            { id: "t", x: 0, y: 0, w: 1, h: 1, minified: true },
            noCaps,
        );
        expect(falseUnit.data.minified).toBe(false);
        expect(trueUnit.data.minified).toBe(true);
    });

    it("8. synthesizes a default execution config when none is persisted", () => {
        const unit = mapSessionStickerToUnit({ id: "e", x: 0, y: 0, w: 1, h: 1 }, noCaps);
        expect(unit.data.executionConfig).toEqual({
            triggerMode: { upstreamDriven: true, paramDriven: true },
            propagation: { listenUpstream: true, notifyDownstream: true },
        });
    });

    it("9. synthesizes art ports from an injected capability", () => {
        const unit = mapSessionStickerToUnit(
            { id: "n", type: "art", artId: "blur", x: 0, y: 0, w: 1, h: 1 },
            { capabilities: [BLUR_CAPABILITY] },
        );

        expect(unit.type).toBe("art");
        expect(unit.artId).toBe("blur");
        expect(unit.inputs.map((p) => p.id)).toEqual(["input_image"]);
        expect(unit.outputs.map((p) => p.id)).toEqual(["result"]);
    });

    it("10. round-trips scalar fields through save -> load unchanged", () => {
        const unit: Unit = {
            id: "rt",
            type: "sticker",
            x: 12,
            y: 34,
            w: 56,
            h: 78,
            params: { k: 1 },
            inputs: [],
            outputs: [],
            data: {
                src: "data:png",
                minified: true,
                savedRect: { x: 1, y: 2, w: 3, h: 4 },
                cropOffset: { x: 7, y: 8 },
                opacityNormal: 0.4,
                opacityMini: 0.2,
                filePath: "/tmp/rt.png",
                groupId: "grp",
                originWorkflowId: "wf",
                originNodeId: "node",
                executionConfig: {
                    triggerMode: { upstreamDriven: false, paramDriven: true },
                    propagation: { listenUpstream: true, notifyDownstream: false },
                },
            },
        };

        const back = mapSessionStickerToUnit(mapUnitToSessionSticker(unit), noCaps);

        expect(back.x).toBe(unit.x);
        expect(back.y).toBe(unit.y);
        expect(back.w).toBe(unit.w);
        expect(back.h).toBe(unit.h);
        expect(back.type).toBe(unit.type);
        expect(back.data.src).toBe("data:png");
        expect(back.data.minified).toBe(true);
        expect(back.data.savedRect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
        expect(back.data.cropOffset).toEqual({ x: 7, y: 8 });
        expect(back.data.opacityNormal).toBe(0.4);
        expect(back.data.opacityMini).toBe(0.2);
        expect(back.data.filePath).toBe("/tmp/rt.png");
        expect(back.data.groupId).toBe("grp");
        expect(back.data.originWorkflowId).toBe("wf");
        expect(back.data.originNodeId).toBe("node");
        expect(back.data.executionConfig).toEqual(unit.data.executionConfig);
    });

    it("11. preserves an empty-string src (the save side's missing-src sentinel)", () => {
        const unit = mapSessionStickerToUnit({ id: "z", x: 0, y: 0, w: 1, h: 1, src: "" }, noCaps);
        expect(unit.data.src).toBe("");
    });
});

describe("detectUnknownSessionStickerKeys", () => {
    it("returns nothing for a fully-recognized sticker", () => {
        const known = mapUnitToSessionSticker(
            mkUnit({ id: "s", data: { src: "x" } }),
        ) as unknown as Record<string, unknown>;
        expect(detectUnknownSessionStickerKeys(known)).toEqual([]);
    });

    it("recognizes every key the save side emits", () => {
        // A round-trip guard: the save projection must not produce any key the
        // drift detector considers unknown.
        const saved = mapUnitToSessionSticker(
            mkUnit({
                id: "s",
                data: {
                    src: "x",
                    previewSrc: "p",
                    savedRect: { x: 0, y: 0, w: 1, h: 1 },
                    cropOffset: { x: 0, y: 0 },
                    filePath: "/f",
                    groupId: "g",
                    originWorkflowId: "wf",
                    originNodeId: "n",
                },
            }),
        ) as unknown as Record<string, unknown>;
        expect(detectUnknownSessionStickerKeys(saved)).toEqual([]);
    });

    it("flags an unrecognized (e.g. renamed) top-level field", () => {
        const drifted = { id: "s", x: 0, y: 0, w: 1, h: 1, preview_src: "renamed" };
        expect(detectUnknownSessionStickerKeys(drifted)).toEqual(["preview_src"]);
    });

    it("returns only the unknown keys from a mixed object", () => {
        const raw = { id: "s", x: 0, minified: true, legacyFoo: 1, bar: 2 };
        expect(detectUnknownSessionStickerKeys(raw).sort()).toEqual(["bar", "legacyFoo"]);
    });

    it("returns nothing for an empty object", () => {
        expect(detectUnknownSessionStickerKeys({})).toEqual([]);
    });
});
