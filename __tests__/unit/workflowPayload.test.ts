import { describe, expect, it } from "vitest";
import { normalizeWorkflowSnapshotPayload } from "../../src/services/workflowPayload";

describe("workflow snapshot payload normalization", () => {
    it("keeps only well-formed nodes and edges from unknown IPC payloads", () => {
        const payload = normalizeWorkflowSnapshotPayload({
            mode: "reference",
            workflowId: "wf-1",
            nodes: [
                {
                    id: "node-a",
                    type: "artNode",
                    position: { x: 12, y: "bad" },
                    measured: { width: 320, height: 180 },
                    data: {
                        artId: "blur",
                        w: 100,
                        h: "bad",
                        params: { strength: 4 },
                        src: "data:image/png;base64,abc",
                        minified: true,
                        opacityNormal: 0.8,
                        savedRect: { x: 1, y: 2, w: 3, h: 4 },
                        cropOffset: { x: 5, y: 6 },
                    },
                },
                { id: 42 },
                null,
            ],
            edges: [
                { source: "node-a", target: "node-b", sourceHandle: "out", targetHandle: "in" },
                { source: "node-a", target: 123 },
            ],
        });

        expect(payload.mode).toBe("reference");
        expect(payload.workflowId).toBe("wf-1");
        expect(payload.nodes).toHaveLength(1);
        expect(payload.nodes[0]).toMatchObject({
            id: "node-a",
            type: "artNode",
            position: { x: 12 },
            measured: { width: 320, height: 180 },
            data: {
                artId: "blur",
                w: 100,
                params: { strength: 4 },
                src: "data:image/png;base64,abc",
                minified: true,
                opacityNormal: 0.8,
                savedRect: { x: 1, y: 2, w: 3, h: 4 },
                cropOffset: { x: 5, y: 6 },
            },
        });
        expect(payload.edges).toEqual([
            { source: "node-a", target: "node-b", sourceHandle: "out", targetHandle: "in" },
        ]);
    });

    it("rejects nodes without a canonical type and Art nodes without an artId", () => {
        const payload = normalizeWorkflowSnapshotPayload({
            nodes: [
                { id: "missing-type", data: { artId: "neuro.official/blur" } },
                { id: "unknown-type", type: "art", data: { artId: "neuro.official/blur" } },
                { id: "missing-art-id", type: "artNode" },
                { id: "sticker-with-stale-art-id", type: "sticker", data: { artId: "old" } },
                { id: "valid-art", type: "artNode", data: { artId: "neuro.official/blur" } },
            ],
            edges: [],
        });

        expect(payload.nodes.map((node) => node.id)).toEqual([
            "sticker-with-stale-art-id",
            "valid-art",
        ]);
        expect(payload.nodes[0].type).toBe("sticker");
        expect(payload.nodes[0].data?.artId).toBeUndefined();
        expect(payload.nodes[1].type).toBe("artNode");
    });

    it("falls back to an empty clone payload for malformed roots", () => {
        expect(normalizeWorkflowSnapshotPayload("not-an-object")).toEqual({
            mode: undefined,
            workflowId: undefined,
            nodes: [],
            edges: [],
        });
    });
});
