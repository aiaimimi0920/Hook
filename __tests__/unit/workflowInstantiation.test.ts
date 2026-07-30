import { describe, expect, it } from "vitest";

import {
    buildWorkflowInstantiation,
    mergeInstantiatedLinks,
    mergeInstantiatedUnits,
    type WorkflowInstantiationDeps,
} from "../../src/services/workflowInstantiation";
import type { ArtCapability } from "../../src/services/protocol";
import type { WorkflowSnapshotPayload } from "../../src/services/workflowPayload";
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

const mkPayload = (over: Partial<WorkflowSnapshotPayload>): WorkflowSnapshotPayload => ({
    mode: undefined,
    workflow_id: undefined,
    nodes: [],
    edges: [],
    ...over,
});

// Deterministic id generator so ids are predictable in assertions.
const counterDeps = (over: Partial<WorkflowInstantiationDeps> = {}): WorkflowInstantiationDeps => {
    let n = 0;
    return {
        existingUnits: [],
        capabilities: [],
        newId: () => `id${++n}`,
        ...over,
    };
};

describe("buildWorkflowInstantiation", () => {
    it("1. returns null for an empty node list", () => {
        expect(buildWorkflowInstantiation(mkPayload({ nodes: [] }), counterDeps())).toBeNull();
    });

    it("2. applies geometry/opacity defaults for a minimal node", () => {
        const result = buildWorkflowInstantiation(
            mkPayload({ nodes: [{ id: "n1" }] }),
            counterDeps(),
        );
        const unit = result!.units[0];
        expect(unit.id).toBe("id1");
        expect(unit.type).toBe("art"); // undefined node.type => art
        expect(unit.x).toBe(0);
        expect(unit.y).toBe(0);
        expect(unit.w).toBe(240);
        expect(unit.h).toBe(180);
        expect(unit.data.minified).toBe(false);
        expect(unit.data.opacityNormal).toBe(1);
        expect(unit.data.opacityMini).toBe(0.9);
    });

    it("3. builds sticker ports for a sticker node", () => {
        const result = buildWorkflowInstantiation(
            mkPayload({ nodes: [{ id: "s", type: "sticker" }] }),
            counterDeps(),
        );
        const unit = result!.units[0];
        expect(unit.type).toBe("sticker");
        expect(unit.inputs.map((p) => p.id)).toEqual(["image"]);
        expect(unit.outputs.map((p) => p.id)).toEqual(["output_image"]);
    });

    it("4. resolves artId (and art_id fallback) plus capability ports", () => {
        const capability = {
            id: "blur",
            inputs: [{ name: "input_image", label: "In", type: "image" }],
            outputs: [{ name: "result", label: "Out", type: "image" }],
            params: [],
        } as unknown as ArtCapability;
        const result = buildWorkflowInstantiation(
            mkPayload({ nodes: [{ id: "n", data: { art_id: "blur" } }] }),
            counterDeps({ capabilities: [capability] }),
        );
        const unit = result!.units[0];
        expect(unit.type).toBe("art");
        expect(unit.artId).toBe("blur");
        expect(unit.outputs.map((p) => p.id)).toEqual(["result"]);
        expect(unit.data.executionConfig).toBeDefined();
    });

    it("4b. still instantiates an art node when a stale payload labels it as sticker but carries artId in node data", () => {
        const capability = {
            id: "color-transfer-art",
            inputs: [{ name: "input_image", label: "In", type: "image" }],
            outputs: [{ name: "output_image", label: "Out", type: "image" }],
            params: [],
        } as unknown as ArtCapability;
        const result = buildWorkflowInstantiation(
            mkPayload({
                nodes: [
                    {
                        id: "n",
                        type: "sticker",
                        data: { artId: "color-transfer-art" },
                    },
                ],
            }),
            counterDeps({ capabilities: [capability] }),
        );
        const unit = result!.units[0];
        expect(unit.type).toBe("art");
        expect(unit.artId).toBe("color-transfer-art");
        expect(unit.inputs.map((p) => p.id)).toEqual(["input_image"]);
        expect(unit.outputs.map((p) => p.id)).toEqual(["output_image"]);
    });

    it("5. prefers data.w over measured.width over the default", () => {
        const both = buildWorkflowInstantiation(
            mkPayload({ nodes: [{ id: "a", data: { w: 100 }, measured: { width: 50 } }] }),
            counterDeps(),
        );
        const measuredOnly = buildWorkflowInstantiation(
            mkPayload({ nodes: [{ id: "b", measured: { width: 50 } }] }),
            counterDeps(),
        );
        expect(both!.units[0].w).toBe(100);
        expect(measuredOnly!.units[0].w).toBe(50);
    });

    it("6. reuses an existing unit id and stamps origin info in reference mode", () => {
        const existing = mkUnit({
            id: "existing-1",
            data: { originWorkflowId: "wf", originNodeId: "A" },
        });
        const result = buildWorkflowInstantiation(
            mkPayload({ mode: "reference", workflow_id: "wf", nodes: [{ id: "A" }] }),
            counterDeps({ existingUnits: [existing] }),
        );
        const unit = result!.units[0];
        expect(unit.id).toBe("existing-1"); // reused, not a fresh id
        expect(unit.data.originWorkflowId).toBe("wf");
        expect(unit.data.originNodeId).toBe("A");
    });

    it("7. mints fresh ids and no origin info outside reference mode", () => {
        const result = buildWorkflowInstantiation(
            mkPayload({ mode: "clone", nodes: [{ id: "A" }] }),
            counterDeps(),
        );
        const unit = result!.units[0];
        expect(unit.id).toBe("id1");
        expect(unit.data.originWorkflowId).toBeUndefined();
        expect(unit.data.originNodeId).toBeUndefined();
    });

    it("8. treats reference mode without a workflow_id as non-reference", () => {
        const existing = mkUnit({
            id: "existing-1",
            data: { originWorkflowId: "wf", originNodeId: "A" },
        });
        const result = buildWorkflowInstantiation(
            mkPayload({ mode: "reference", workflow_id: null, nodes: [{ id: "A" }] }),
            counterDeps({ existingUnits: [existing] }),
        );
        expect(result!.units[0].id).toBe("id1"); // not reused
        expect(result!.units[0].data.originNodeId).toBeUndefined();
    });

    it("9. maps edges through the id map, dropping edges to unknown nodes and defaulting ports", () => {
        const result = buildWorkflowInstantiation(
            mkPayload({
                nodes: [{ id: "A" }, { id: "B" }],
                edges: [
                    { source: "A", target: "B" }, // valid -> mapped
                    { source: "A", target: "ghost" }, // dropped
                ],
            }),
            counterDeps(),
        );
        expect(result!.links).toHaveLength(1);
        const link = result!.links[0];
        expect(link.fromUnitId).toBe("id1"); // A
        expect(link.toUnitId).toBe("id2"); // B
        expect(link.fromPortId).toBe("output");
        expect(link.toPortId).toBe("input");
        expect(link.id).toBe("id3"); // link id minted after the two node ids
    });

    it("10. honors explicit edge handles", () => {
        const result = buildWorkflowInstantiation(
            mkPayload({
                nodes: [{ id: "A" }, { id: "B" }],
                edges: [{ source: "A", target: "B", sourceHandle: "out1", targetHandle: "in1" }],
            }),
            counterDeps(),
        );
        expect(result!.links[0].fromPortId).toBe("out1");
        expect(result!.links[0].toPortId).toBe("in1");
    });
});

describe("mergeInstantiatedUnits", () => {
    it("11. upserts by id: replaces matching units, keeps others, appends new", () => {
        const prev = [mkUnit({ id: "keep" }), mkUnit({ id: "dup", x: 1 })];
        const incoming = [mkUnit({ id: "dup", x: 99 }), mkUnit({ id: "new" })];
        const merged = mergeInstantiatedUnits(prev, incoming);
        expect(merged.map((u) => u.id)).toEqual(["keep", "dup", "new"]);
        expect(merged.find((u) => u.id === "dup")!.x).toBe(99);
    });
});

describe("mergeInstantiatedLinks", () => {
    const link = (id: string, from: string, to: string): Link => ({
        id,
        fromUnitId: from,
        fromPortId: "output",
        toUnitId: to,
        toPortId: "input",
    });

    it("12. drops previous links whose both endpoints are re-instantiated, then appends new", () => {
        const prev = [link("old", "A", "B")];
        const incoming = [link("fresh", "A", "B")];
        const merged = mergeInstantiatedLinks(prev, incoming, new Set(["A", "B"]));
        expect(merged.map((l) => l.id)).toEqual(["fresh"]);
    });

    it("13. keeps a previous link when only one endpoint is re-instantiated", () => {
        const prev = [link("old", "A", "X")]; // X not referenced
        const merged = mergeInstantiatedLinks(prev, [], new Set(["A", "B"]));
        expect(merged.map((l) => l.id)).toEqual(["old"]);
    });

    it("14. de-duplicates by from/port/to/port so an identical new link is not appended twice", () => {
        const prev = [link("old", "A", "X")]; // survives (X not referenced)
        const incoming = [link("dupe", "A", "X")]; // same key as survivor
        const merged = mergeInstantiatedLinks(prev, incoming, new Set(["B"]));
        expect(merged.map((l) => l.id)).toEqual(["old"]);
    });
});
