import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtCapability } from "../../src/services/protocol";
import type { Unit } from "../../src/types/unit";

const state = vi.hoisted(() => ({
    units: [] as Unit[],
    surfaces: {} as Record<string, {
        snapshot: { viewId?: string; resourceLeases?: unknown[] };
        generation: number;
    }>,
    updateUnitData: vi.fn(),
    attachSurface: vi.fn(),
    fetchSurfaceResource: vi.fn(),
    beginAttachment: vi.fn(() => true),
    failAttachment: vi.fn(),
    beginResource: vi.fn(() => true),
    failResource: vi.fn(),
}));

vi.mock("../../src/services/client", () => ({
    loomHook: {
        attachSurface: state.attachSurface,
        fetchSurfaceResource: state.fetchSurfaceResource,
    },
}));

vi.mock("../../src/store/graphStore", () => ({
    graphStore: {
        units: state.units,
        links: [],
        capabilities: [],
        actions: { updateUnitData: state.updateUnitData },
    },
}));

vi.mock("../../src/store/surfaceStore", () => ({
    surfaceStore: { byUnit: state.surfaces },
}));

vi.mock("../../src/store/surfaceResourceStore", () => ({
    surfaceResourceStore: {
        actions: {
            begin: state.beginResource,
            fail: state.failResource,
            resolve: vi.fn(),
        },
    },
}));

vi.mock("../../src/services/surfaceAttachmentRequests", () => ({
    surfaceAttachmentRequests: {
        begin: state.beginAttachment,
        fail: state.failAttachment,
    },
}));

vi.mock("../../src/services/artCapabilities", () => ({
    supportsSurface: () => true,
    supportsShaderPreview: () => false,
    shaderInputPortName: () => undefined,
    shaderReferenceInputPortName: () => undefined,
}));

import { createUnitSurfaceController } from "../../src/components/unitSurfaceController";

const capability = {
    id: "surface-art",
    label: "Surface Art",
    description: "",
    supported_transports: [],
    params: [],
} as ArtCapability;

const createUnit = (artId = "surface-art"): Unit => ({
    id: "surface-unit",
    type: "art",
    artId,
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    params: {},
    inputs: [],
    outputs: [],
    data: {},
});

const mountController = (unit: () => Unit) => {
    let dispose: () => void = () => undefined;
    createRoot((rootDispose) => {
        dispose = rootDispose;
        createUnitSurfaceController({
            unit,
            capability: () => capability,
            params: () => ({}),
            resolveUnitImage: () => undefined,
            onResize: vi.fn(),
        });
    });
    return dispose;
};

const flushPromises = async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

describe("unit surface controller async failures", () => {
    beforeEach(() => {
        state.units.splice(0, state.units.length, createUnit());
        for (const key of Object.keys(state.surfaces)) delete state.surfaces[key];
        vi.clearAllMocks();
        state.beginAttachment.mockReturnValue(true);
        state.beginResource.mockReturnValue(true);
    });

    it("reports a current attach failure but ignores one from a replaced Art", async () => {
        state.attachSurface.mockRejectedValueOnce(new Error("current attach failed"));
        let currentUnit = state.units[0];
        const disposeCurrent = mountController(() => currentUnit);
        await flushPromises();
        expect(state.failAttachment).toHaveBeenCalledWith("surface-unit");
        expect(state.updateUnitData).toHaveBeenCalledWith("surface-unit", {
            nodeStatus: "error",
            errorMessage: "current attach failed",
        });
        disposeCurrent();

        vi.clearAllMocks();
        state.beginAttachment.mockReturnValue(true);
        let rejectAttach!: (error: Error) => void;
        state.attachSurface.mockReturnValue(new Promise<void>((_, reject) => {
            rejectAttach = reject;
        }));
        currentUnit = createUnit();
        state.units.splice(0, state.units.length, currentUnit);
        const disposeStale = mountController(() => currentUnit);
        currentUnit = createUnit("replacement-art");
        state.units.splice(0, state.units.length, currentUnit);
        rejectAttach(new Error("stale attach failed"));
        await flushPromises();

        expect(state.failAttachment).not.toHaveBeenCalled();
        expect(state.updateUnitData).not.toHaveBeenCalled();
        disposeStale();
    });

    it("releases a failed resource request without marking a newer surface generation as failed", async () => {
        const resourceId = `sha256:${"a".repeat(64)}`;
        state.surfaces["surface-unit"] = {
            generation: 1,
            snapshot: {
                resourceLeases: [{
                    transport: { kind: "loom_resource" },
                    resource: { resourceId },
                }],
            },
        };
        let rejectFetch!: (error: Error) => void;
        state.fetchSurfaceResource.mockReturnValue(new Promise<void>((_, reject) => {
            rejectFetch = reject;
        }));
        const dispose = mountController(() => state.units[0]);
        state.surfaces["surface-unit"] = {
            ...state.surfaces["surface-unit"],
            generation: 2,
        };

        rejectFetch(new Error("stale resource failed"));
        await flushPromises();
        expect(state.failResource).toHaveBeenCalledWith(resourceId);
        expect(state.updateUnitData).not.toHaveBeenCalled();
        dispose();
    });
});
