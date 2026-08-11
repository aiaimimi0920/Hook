import { beforeEach, describe, expect, it } from "vitest";

import {
    SurfaceStateError,
    applySurfacePatchToSnapshot,
    surfaceStore,
} from "../../src/store/surfaceStore";
import {
    SURFACE_PROTOCOL_VERSION,
    type SurfacePatch,
    type SurfacePreviewCommit,
    type SurfaceResultCommit,
    type SurfaceSnapshot,
} from "../../src/services/surfaceProtocol";

const snapshot = (): SurfaceSnapshot => ({
    protocolVersion: SURFACE_PROTOCOL_VERSION,
    instanceId: "instance:stock",
    attachmentId: "attachment:desktop",
    artId: "neuro.official/stock-price",
    artVersion: "1.0.0",
    revision: 1,
    scene: {
        id: "root",
        type: "column",
        children: [
            { id: "price", type: "text", props: { text: "100" } },
        ],
    },
    authoritativeState: { price: 100, obsolete: true },
    resources: [],
});

describe("Surface state store", () => {
    beforeEach(() => surfaceStore.actions.clearAll());

    it("applies ordered patches transactionally", () => {
        const patch: SurfacePatch = {
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: "instance:stock",
            attachmentId: "attachment:desktop",
            baseRevision: 1,
            revision: 2,
            operations: [
                {
                    op: "set",
                    nodeId: "price",
                    path: "/props/text",
                    value: "101",
                },
            ],
            statePatch: { price: 101, obsolete: null },
        };

        const next = applySurfacePatchToSnapshot(snapshot(), patch);
        expect(next.revision).toBe(2);
        expect(next.scene.children?.[0].props).toEqual({ text: "101" });
        expect(next.authoritativeState).toEqual({ price: 101 });
    });

    it("rejects stale patches without changing current state", () => {
        surfaceStore.actions.mountSnapshot("unit:stock", snapshot(), 3);
        const stale: SurfacePatch = {
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: "instance:stock",
            attachmentId: "attachment:desktop",
            baseRevision: 0,
            revision: 2,
            operations: [],
        };

        expect(() => surfaceStore.actions.applyPatch("unit:stock", stale)).toThrowError(
            SurfaceStateError,
        );
        expect(surfaceStore.byUnit["unit:stock"].snapshot.revision).toBe(1);
        expect(surfaceStore.byUnit["unit:stock"].generation).toBe(3);
    });

    it("restores a full snapshot after the Hook local state is recreated", () => {
        const recovered = snapshot();
        recovered.revision = 4;
        recovered.authoritativeState = { price: 104, refreshed: true };
        recovered.resources = [{
            resourceId: "sha256:recovered",
            kind: "binary",
            mime: "image/png",
            size: 4,
        }];
        recovered.resourceLeases = [{
            leaseId: "lease:recovered",
            resource: recovered.resources[0],
            transport: { kind: "loom_resource" },
            expiresAtMs: Date.now() + 60_000,
        }];

        surfaceStore.actions.mountSnapshot("unit:stock", snapshot(), 3);
        surfaceStore.actions.clearAll();
        surfaceStore.actions.mountSnapshot("unit:stock", recovered, 7);

        expect(surfaceStore.byUnit["unit:stock"].snapshot.revision).toBe(4);
        expect(surfaceStore.byUnit["unit:stock"].generation).toBe(7);
        expect(surfaceStore.byUnit["unit:stock"].snapshot.authoritativeState).toEqual({
            price: 104,
            refreshed: true,
        });
        expect(surfaceStore.byUnit["unit:stock"].snapshot.resourceLeases?.[0].leaseId)
            .toBe("lease:recovered");
    });

    it("rejects patches that duplicate stable scene ids", () => {
        const invalid: SurfacePatch = {
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: "instance:stock",
            attachmentId: "attachment:desktop",
            baseRevision: 1,
            revision: 2,
            operations: [
                {
                    op: "insert_node",
                    parentId: "root",
                    index: 1,
                    node: { id: "price", type: "text" },
                },
            ],
        };

        expect(() => applySurfacePatchToSnapshot(snapshot(), invalid)).toThrow(
            "duplicate Surface node id",
        );
    });

    it("tracks preview and formal revisions independently and rejects stale commits", () => {
        surfaceStore.actions.mountSnapshot("unit:stock", snapshot(), 3);
        const preview: SurfacePreviewCommit = {
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: "instance:stock",
            requestId: "request:preview",
            generation: 3,
            previewRevision: 1,
            portId: "preview",
            value: { kind: "value", value: "data:image/png;base64,AA==" },
        };
        const result: SurfaceResultCommit = {
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: "instance:stock",
            requestId: "request:formal",
            generation: 3,
            resultRevision: 1,
            outputs: { price: { kind: "value", value: 101 } },
        };

        expect(surfaceStore.actions.acceptPreviewCommit("unit:stock", preview)).toBe(true);
        expect(surfaceStore.actions.acceptPreviewCommit("unit:stock", preview)).toBe(false);
        expect(surfaceStore.actions.acceptResultCommit("unit:stock", result)).toBe(true);
        expect(surfaceStore.actions.acceptResultCommit("unit:stock", result)).toBe(false);
        expect(surfaceStore.byUnit["unit:stock"].previewRevision).toBe(1);
        expect(surfaceStore.byUnit["unit:stock"].resultRevision).toBe(1);
        expect(surfaceStore.actions.acceptResultCommit("unit:stock", {
            ...result,
            generation: 2,
            resultRevision: 2,
        })).toBe(false);
    });

    it("applies ordered lifecycle events and ignores stale attachment updates", () => {
        surfaceStore.actions.mountSnapshot("unit:stock", snapshot(), 0);
        expect(surfaceStore.byUnit["unit:stock"].lifecycle).toBe("mounted");
        expect(surfaceStore.actions.applyLifecycle("unit:stock", {
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: "instance:stock",
            attachmentId: "attachment:desktop",
            state: "active",
            revision: 2,
        })).toBe(true);
        expect(surfaceStore.byUnit["unit:stock"].lifecycle).toBe("active");
        expect(surfaceStore.actions.applyLifecycle("unit:stock", {
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: "instance:stock",
            attachmentId: "attachment:desktop",
            state: "suspended",
            revision: 1,
        })).toBe(false);
        expect(surfaceStore.actions.applyLifecycle("unit:stock", {
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: "instance:other",
            attachmentId: "attachment:desktop",
            state: "disposed",
            revision: 3,
        })).toBe(false);
    });
});
