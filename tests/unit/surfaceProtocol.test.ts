import { describe, expect, it } from "vitest";

import {
    DECLARATIVE_SURFACE_NODE_TYPES,
    SURFACE_PROTOCOL_VERSION,
    canApplySurfacePatch,
    validateSurfaceNodeIds,
    type SurfaceNode,
    type SurfacePatch,
} from "../../src/features/surfaces/services/surfaceProtocol";
import { otterSurfaceHostCapabilities } from "../../src/features/surfaces/services/surfaceHostCapabilities";

describe("Surface protocol", () => {
    it("requires stable unique scene node ids", () => {
        const scene: SurfaceNode = {
            id: "root",
            type: "column",
            children: [
                { id: "price", type: "text" },
                { id: "price", type: "text" },
            ],
        };

        expect(validateSurfaceNodeIds(scene)).toEqual([
            "duplicate Surface node id: price",
        ]);
    });

    it("applies only a patch for the current base revision", () => {
        const patch: SurfacePatch = {
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: "instance:stock",
            attachmentId: "attachment:desktop",
            baseRevision: 4,
            revision: 5,
            operations: [],
        };

        expect(canApplySurfacePatch(4, patch)).toBe(true);
        expect(canApplySurfacePatch(3, patch)).toBe(false);
        expect(canApplySurfacePatch(5, { ...patch, revision: 4 })).toBe(false);
    });

    it("advertises the declarative and sandboxed JavaScript runtimes implemented by Otter", () => {
        const capabilities = otterSurfaceHostCapabilities();
        expect(capabilities.runtimes).toEqual(["declarative", "javascript"]);
        expect(capabilities.nodes).toEqual([...DECLARATIVE_SURFACE_NODE_TYPES]);
        expect(capabilities.transports).toEqual(["loom_resource"]);
        expect(capabilities.capabilities).toEqual([
            "remote_resources",
            "surface.javascript.v1",
        ]);
        expect(capabilities.input).toEqual({
            pointer: true,
            hover: true,
            touch: true,
            keyboard: true,
        });
    });
});
