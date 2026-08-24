import { describe, expect, it } from "vitest";
import {
    resolveMissingUnitExecutionImagePorts,
    resolveEffectiveNodeParams,
    resolveUnitExecutionImageInputs,
} from "../../src/services/graphImageResolution";
import type { ArtCapability } from "../../src/services/protocol";
import type { Link, Unit } from "../../src/types/unit";
import { sticker } from "./graphImageResolutionTestFixtures";

describe("graph image resolution: capability parameters", () => {
    it("ignores stale image links when the capability explicitly declares no inputs", () => {
        const source = sticker("source", { src: "data:image/png;base64,source" });
        const generator: Unit = {
            id: "image-search",
            type: "art",
            artId: "publisher.example/image-search",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            params: {},
            inputs: [{ id: "input_image", type: "image", direction: "input", label: "input_image" }],
            outputs: [{ id: "output", type: "image", direction: "output" }],
            data: {},
        };
        const links: Link[] = [{
            id: "stale-generator-link",
            fromUnitId: source.id,
            fromPortId: "output",
            toUnitId: generator.id,
            toPortId: "input_image",
        }];
        const capabilities: ArtCapability[] = [{
            id: "publisher.example/image-search",
            label: "Image Search",
            description: "",
            supported_transports: ["shared_memory"],
            params: [],
            inputs: [],
            outputs: [{ name: "output", label: "Output", type: "image" }],
        }];

        expect(resolveUnitExecutionImageInputs({
            units: [source, generator],
            links,
            unitId: generator.id,
            capabilities,
        })).toEqual({});
        expect(resolveMissingUnitExecutionImagePorts({
            units: [source, generator],
            links,
            unitId: generator.id,
            capabilities,
        })).toEqual([]);
    });

    it("does not include capability-declared secrets in Art execution params", () => {
        const generator: Unit = {
            id: "image-search",
            type: "art",
            artId: "publisher.example/image-search",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            params: {
                query: "red panda",
                brave_api_key: "must-not-leave-hook",
            },
            inputs: [],
            outputs: [{ id: "output", type: "image", direction: "output" }],
            data: {},
        };
        const capabilities: ArtCapability[] = [{
            id: "publisher.example/image-search",
            label: "Image Search",
            description: "",
            supported_transports: ["shared_memory"],
            params: [
                { id: "query", label: "Query", widget: "text", default: "" },
                { id: "brave_api_key", label: "Brave API Key", widget: "text", default: undefined, secret: true },
            ],
            inputs: [],
            outputs: [{ name: "output", label: "Output", type: "image" }],
        }];

        expect(resolveEffectiveNodeParams({
            units: [generator],
            links: [],
            unitId: generator.id,
            capabilities,
        })).toEqual({ query: "red panda" });
    });

    it("does not include Hook control fields in Art execution params", () => {
        const generator: Unit = {
            id: "image-search",
            type: "art",
            artId: "publisher.example/image-search",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            params: {
                query: "red panda",
                result_index: 1,
                __exec_manualTrigger: 123,
                __exec_expanded: true,
                __ui_resize: { w: 320, h: 240 },
                force_update: 456,
            },
            inputs: [],
            outputs: [{ id: "output", type: "image", direction: "output" }],
            data: {},
        };
        const capabilities: ArtCapability[] = [{
            id: "publisher.example/image-search",
            label: "Image Search",
            description: "",
            supported_transports: ["shared_memory"],
            params: [
                { id: "query", label: "Query", widget: "text", default: "" },
            ],
            inputs: [],
            outputs: [{ name: "output", label: "Output", type: "image" }],
        }];

        expect(resolveEffectiveNodeParams({
            units: [generator],
            links: [],
            unitId: generator.id,
            capabilities,
        })).toEqual({
            query: "red panda",
            result_index: 1,
        });
    });

});
