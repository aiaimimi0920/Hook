import { describe, expect, it } from "vitest";
import { normalizeWorkflowSnapshotPayload } from "../../src/services/workflowPayload";

describe("workflow snapshot payload normalization", () => {
    it("keeps only well-formed nodes and edges from unknown IPC payloads", () => {
        const payload = normalizeWorkflowSnapshotPayload({
            mode: "reference",
            workflow_id: "wf-1",
            nodes: [
                {
                    id: "node-a",
                    type: "sticker",
                    position: { x: 12, y: "bad" },
                    measured: { width: 320, height: 180 },
                    data: {
                        art_id: "blur",
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
        expect(payload.workflow_id).toBe("wf-1");
        expect(payload.nodes).toHaveLength(1);
        expect(payload.nodes[0]).toMatchObject({
            id: "node-a",
            type: "sticker",
            position: { x: 12 },
            measured: { width: 320, height: 180 },
            data: {
                art_id: "blur",
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

    it("falls back to an empty clone payload for malformed roots", () => {
        expect(normalizeWorkflowSnapshotPayload("not-an-object")).toEqual({
            mode: undefined,
            workflow_id: undefined,
            nodes: [],
            edges: [],
        });
    });
});
