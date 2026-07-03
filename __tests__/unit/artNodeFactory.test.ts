import { describe, expect, it } from "vitest";
import { buildStandaloneArtNodeUnit, buildUnitPortsFromCapability } from "../../src/services/artNodeFactory";
import type { ArtCapability } from "../../src/services/protocol";

const imageSearchCapability: ArtCapability = {
    id: "custom-image-search",
    label: "图片搜索",
    description: "",
    supported_transports: ["shared_memory"],
    execution_type: "mcp",
    execution: {
        tool_name: "brave_image_search",
        input_schema: {
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
    ],
    inputs: [
        { name: "count", label: "count", type: "number" },
        { name: "query", label: "query", type: "text" },
        { name: "safesearch", label: "safesearch", type: "text" },
        { name: "spellcheck", label: "spellcheck", type: "text" },
    ],
    outputs: [{ name: "output", label: "output", type: "image" }],
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

    it("keeps image-link parameters on the parameter row instead of creating duplicate node endpoints", () => {
        const colorTransferCapability: ArtCapability = {
            id: "color-transfer",
            label: "Color Transfer",
            description: "",
            supported_transports: ["shared_memory"],
            execution_type: "python",
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
});
