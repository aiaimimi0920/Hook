import { describe, expect, it } from "vitest";
import { deriveUnitExecutionConfig } from "../../src/services/nodeExecutionConfig";
import type { ArtCapability } from "../../src/services/protocol";

const imageSearchCapability: ArtCapability = {
    id: "custom-image-search",
    label: "图片搜索",
    description: "",
    supported_transports: ["shared_memory"],
    execution_type: "mcp",
    execution: {
        tool_name: "brave_image_search",
    },
    params: [],
    outputs: [{ name: "output", label: "output", type: "image" }],
};

const removeBgCapability: ArtCapability = {
    id: "remove-bg",
    label: "Remove BG",
    description: "",
    supported_transports: ["shared_memory"],
    execution_type: "cloud_api",
    params: [],
    outputs: [{ name: "output", label: "output", type: "image" }],
};

describe("node execution config defaults", () => {
    it("treats empty image-search config as manual-only", () => {
        const config = deriveUnitExecutionConfig({
            capability: imageSearchCapability,
            explicitConfig: {},
        });

        expect(config.triggerMode.paramDriven).toBe(false);
        expect(config.triggerMode.upstreamDriven).toBe(true);
        expect(config.propagation.listenUpstream).toBe(true);
        expect(config.propagation.notifyDownstream).toBe(true);
    });

    it("preserves explicit param-driven image-search config", () => {
        const config = deriveUnitExecutionConfig({
            capability: imageSearchCapability,
            explicitConfig: {
                triggerMode: { upstreamDriven: true, paramDriven: true },
                propagation: { listenUpstream: true, notifyDownstream: true },
            },
        });

        expect(config.triggerMode.paramDriven).toBe(true);
    });

    it("keeps non-image-search nodes reactive when config is empty", () => {
        const config = deriveUnitExecutionConfig({
            capability: removeBgCapability,
            explicitConfig: {},
        });

        expect(config.triggerMode.paramDriven).toBe(true);
    });
});
