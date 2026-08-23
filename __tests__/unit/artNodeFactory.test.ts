import { describe, expect, it } from "vitest";
import { buildStandaloneArtNodeUnit, buildUnitPortsFromCapability } from "../../src/services/artNodeFactory";
import type { ArtCapability } from "../../src/services/protocol";

const imageSearchCapability: ArtCapability = {
    id: "custom-image-search",
    label: "图片搜索",
    description: "",
    supported_transports: ["shared_memory"],
    execution: {
        type: "mcp",
        toolName: "brave_image_search",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", minLength: 1, maxLength: 400 },
                count: { type: "integer", default: 50, minimum: 1, maximum: 200 },
                spellcheck: { type: "boolean", default: true },
            },
            required: ["query"],
        },
    },
    params: [
        { id: "count", label: "count", widget: "number", default: "1" },
        { id: "query", label: "query", widget: "text", default: "" },
        { id: "safesearch", label: "safesearch", widget: "text", default: "off" },
        { id: "spellcheck", label: "spellcheck", widget: "text", default: "true" },
        // Secret params carry no default: the normalizer drops it so the value
        // never reaches the node params (see artCapabilityNormalization).
        { id: "brave_api_key", label: "Brave API Key", widget: "text", default: undefined, secret: true },
    ],
    inputs: [
        { name: "count", label: "count", type: "number" },
        { name: "query", label: "query", type: "text" },
        { name: "safesearch", label: "safesearch", type: "text" },
        { name: "spellcheck", label: "spellcheck", type: "text" },
    ],
    outputs: [{ name: "output", label: "output", type: "image" }],
};

const surfaceCapability: ArtCapability = {
    ...imageSearchCapability,
    id: "custom-stock-monitor",
    metadata: {
        capabilities: {
            surface: {
                protocolVersion: "loom.surface.v1",
                apiVersion: "1.0",
                variants: [{ runtime: "javascript", entry: "surface/main.js" }],
                minimumSize: { width: 760, height: 640 },
            },
        },
    },
};

const multiViewSurfaceCapability: ArtCapability = {
    ...surfaceCapability,
    metadata: {
        capabilities: {
            surface: {
                protocolVersion: "loom.surface.v1",
                apiVersion: "1.0",
                variants: [{ runtime: "javascript", entry: "surface/main.js" }],
                minimumSize: { width: 320, height: 240 },
                views: [
                    { id: "full", label: "全视图", fullSize: { width: 960, height: 820 } },
                    { id: "price", label: "交易价格视图", fullSize: { width: 620, height: 560 } },
                ],
                defaultViewId: "full",
            },
        },
    },
};

describe("standalone ArtNode factory", () => {
    it("keeps pure generator params editable without forcing upstream sticker ports", () => {
        expect(buildUnitPortsFromCapability("art", imageSearchCapability)).toEqual({
            inputs: [],
            outputs: [{ id: "output", type: "image", direction: "output", label: "output" }],
        });
    });

    it("creates an independent ArtNode at the requested canvas position with default params", () => {
        const unit = buildStandaloneArtNodeUnit({
            id: "node-1",
            capability: imageSearchCapability,
            x: 120,
            y: 80,
        });

        expect(unit).toMatchObject({
            id: "node-1",
            type: "art",
            artId: "custom-image-search",
            x: 120,
            y: 80,
            w: 320,
            h: 240,
            params: {
                count: 1,
                query: "",
                safesearch: "off",
                spellcheck: true,
            },
            data: {},
        });
        expect(unit.inputs.map((input) => input.id)).toEqual([]);
        expect(unit.outputs.map((output) => output.id)).toEqual(["output"]);
        expect(unit.params).not.toHaveProperty("brave_api_key");
    });

    it("creates MCP image-search nodes as manual-only by default", () => {
        const unit = buildStandaloneArtNodeUnit({
            id: "node-1",
            capability: imageSearchCapability,
            x: 120,
            y: 80,
        });

        expect(unit.data.executionConfig).toEqual({
            triggerMode: {
                upstreamDriven: true,
                paramDriven: false,
            },
            propagation: {
                listenUpstream: true,
                notifyDownstream: true,
            },
        });
    });

    it("raises requested dimensions to the Surface minimum size", () => {
        const unit = buildStandaloneArtNodeUnit({
            id: "surface-node",
            capability: surfaceCapability,
            x: 120,
            y: 80,
            w: 320,
            h: 240,
        });

        expect(unit).toMatchObject({ w: 760, h: 640 });
    });

    it("preserves requested dimensions above the Surface minimum size", () => {
        const unit = buildStandaloneArtNodeUnit({
            id: "surface-node",
            capability: surfaceCapability,
            x: 120,
            y: 80,
            w: 1024,
            h: 768,
        });

        expect(unit).toMatchObject({ w: 1024, h: 768 });
    });

    it("opens a multi-view Art at the default view full size", () => {
        const unit = buildStandaloneArtNodeUnit({
            id: "surface-node",
            capability: multiViewSurfaceCapability,
            x: 120,
            y: 80,
            w: 320,
            h: 240,
        });

        expect(unit).toMatchObject({
            w: 960,
            h: 820,
            data: { surfaceViewId: "full" },
        });
    });

    it("falls back to stable defaults when requested dimensions are invalid", () => {
        const unit = buildStandaloneArtNodeUnit({
            id: "surface-node",
            capability: imageSearchCapability,
            x: 120,
            y: 80,
            w: Number.NaN,
            h: -1,
        });

        expect(unit).toMatchObject({ w: 320, h: 240 });
    });

    it("keeps image-link parameters on the parameter row instead of creating duplicate node endpoints", () => {
        const colorTransferCapability: ArtCapability = {
            id: "color-transfer",
            label: "Color Transfer",
            description: "",
            supported_transports: ["shared_memory"],
            execution: { type: "framework_art" },
            params: [
                { id: "reference_image", label: "Reference Image", widget: "image_link", default: "" },
                { id: "gamma", label: "Gamma", widget: "number", default: 1 },
            ],
            inputs: [
                { name: "input_image", label: "Input Image", type: "image" },
                { name: "reference_image", label: "Reference Image", type: "image" },
                { name: "gamma", label: "Gamma", type: "number" },
            ],
            outputs: [{ name: "output_image", label: "Image", type: "image" }],
        };

        const ports = buildUnitPortsFromCapability("art", colorTransferCapability);

        expect(ports.inputs.map((input) => input.id)).toEqual(["input_image"]);
    });

    it("preserves an opted-in reference image port for true two-image script arts", () => {
        const imageBlendCapability: ArtCapability = {
            id: "custom-image-blend-script",
            label: "图片混合",
            description: "",
            supported_transports: ["shared_memory"],
            execution: { type: "framework_art" },
            params: [
                { id: "reference", label: "参考图", widget: "image_link", default: "" },
                { id: "mix_ratio", label: "混合比例", widget: "slider", default: 50, min: 0, max: 100 },
            ],
            inputs: [
                { name: "input", label: "源图", type: "image" },
                { name: "reference", label: "参考图", type: "image", exposePort: true } as any,
            ],
            outputs: [{ name: "output", label: "结果", type: "image" }],
        };

        const ports = buildUnitPortsFromCapability("art", imageBlendCapability);

        expect(ports.inputs.map((input) => input.id)).toEqual(["input", "reference"]);
    });

    it("builds a workflow Art with its declared image port and default parameters", () => {
        const workflowCapability: ArtCapability = {
            id: "local-workflow-art",
            label: "本地流程",
            description: "",
            supported_transports: ["shared_memory"],
            execution: { type: "workflow", workflowId: "workflow-1" },
            params: [
                { id: "strength", label: "强度", widget: "slider", default: 0.75 },
            ],
            inputs: [{ name: "input", label: "输入", type: "image" }],
            outputs: [{ name: "result", label: "结果", type: "image" }],
        };

        const unit = buildStandaloneArtNodeUnit({
            id: "workflow-node",
            capability: workflowCapability,
            x: 320,
            y: 180,
            w: 100,
            h: 200,
        });

        expect(unit).toMatchObject({
            type: "art",
            artId: "local-workflow-art",
            w: 100,
            h: 200,
            params: { strength: 0.75 },
            inputs: [{ id: "input", type: "image", direction: "input" }],
            outputs: [{ id: "result", type: "image", direction: "output" }],
        });
    });
});
