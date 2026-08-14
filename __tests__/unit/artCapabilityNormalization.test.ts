import { describe, expect, it } from "vitest";
import { normalizeArtCapabilities } from "../../src/services/artCapabilityNormalization";
import { findArtCapability } from "../../src/services/artCapabilityLookup";

describe("Loom Art capability normalization", () => {
    it("normalizes current framework Art manifests without dropping package metadata", () => {
        const [capability] = normalizeArtCapabilities([
            {
                id: "publisher.example/color-transfer",
                label: "Color Transfer",
                description: "",
                enabled: true,
                execution: {
                    type: "framework_art",
                    framework: "process",
                },
                inputs: [
                    {
                        name: "input",
                        label: "Input",
                        type: "image",
                        execution_type: "image_buffer",
                    },
                ],
                outputs: [
                    {
                        name: "output",
                        label: "Output",
                        type: "image",
                        execution_type: "image_buffer",
                    },
                ],
                parameters: [
                    {
                        id: "strength",
                        label: "Strength",
                        widget: "slider",
                        min: 0,
                        max: 1,
                        group: "Basic",
                    },
                    {
                        id: "mode",
                        label: "Mode",
                        widget: "select",
                        default: "quality",
                        options: [
                            { value: "quality", label: "Quality" },
                            { value: "speed", label: "Speed" },
                        ],
                    },
                ],
                defaults: { strength: 0.75 },
                metadata: {
                    capabilities: {
                        preview: "image",
                    },
                },
            },
        ]);

        expect(capability).toMatchObject({
            id: "publisher.example/color-transfer",
            label: "Color Transfer",
            description: "",
            supported_transports: ["shared_memory"],
            execution: {
                type: "framework_art",
                framework: "process",
            },
        });
        expect(capability.params[0]).toMatchObject({
            id: "strength",
            default: 0.75,
            group: "Basic",
        });
        expect(capability.params[1].options).toEqual([
            { value: "quality", label: "Quality" },
            { value: "speed", label: "Speed" },
        ]);
        expect(capability.inputs?.[0].execution_type).toBe("image_buffer");
        expect(capability.outputs?.[0].execution_type).toBe("image_buffer");
        expect(capability.metadata?.capabilities).toEqual({ preview: "image" });
        expect(findArtCapability([capability], "color-transfer")).toBeUndefined();
        expect(findArtCapability([capability], "publisher.example/color-transfer")).toBe(capability);
    });

    it("rejects legacy identity and field aliases", () => {
        const capabilities = normalizeArtCapabilities([
            {
                art_id: "legacy-art",
                name: "Legacy Art",
                autoProcess: true,
                executionType: "workflow",
            },
        ]);

        expect(capabilities).toEqual([]);
    });

    it("does not normalize legacy nested field aliases", () => {
        const [capability] = normalizeArtCapabilities([{
            id: "canonical-art",
            label: "Canonical Art",
            inputs: [{ id: "old-input", executionType: "image_buffer" }],
            outputs: [{ name: "output", executionType: "image_buffer" }],
            parameters: [{ name: "quality", dataType: "number", minimum: 1, maximum: 100 }],
        }]);

        expect(capability.inputs).toEqual([]);
        expect(capability.outputs?.[0].execution_type).toBeUndefined();
        expect(capability.params).toEqual([]);
    });

    it("does not derive identity from package metadata", () => {
        const [capability] = normalizeArtCapabilities([
            {
                id: "shared-art",
                label: "Shared Art",
                metadata: {
                    packageSecurity: {
                        publisher: { id: "publisher.alpha" },
                    },
                },
            },
        ]);

        expect(capability.id).toBe("shared-art");
    });

    it("normalizes canonical secret parameter types without exposing a default", () => {
        const [capability] = normalizeArtCapabilities([{
            id: "publisher.example/image-search",
            label: "Image Search",
            parameters: [{
                id: "brave_api_key",
                label: "Brave API Key",
                type: "secret",
                required: true,
                default: "must-not-persist",
            }],
        }]);

        expect(capability.params[0]).toMatchObject({
            id: "brave_api_key",
            data_type: "secret",
            secret: true,
            required: true,
        });
        expect(capability.params[0].default).toBeUndefined();
    });

    it("does not allow a conflicting boolean flag to downgrade a canonical secret type", () => {
        const [capability] = normalizeArtCapabilities([{
            id: "publisher.example/image-search",
            label: "Image Search",
            parameters: [{
                id: "brave_api_key",
                type: "secret",
                secret: false,
                default: "must-not-persist",
            }],
        }]);

        expect(capability.params[0].secret).toBe(true);
        expect(capability.params[0].default).toBeUndefined();
    });

    it("infers new parameter widgets and filters disabled or invalid Arts", () => {
        const capabilities = normalizeArtCapabilities([
            {
                id: "layout-test",
                label: "Layout",
                parameters: [
                    { id: "directory", data_type: "path", default: ".\\out" },
                    { id: "metadata", data_type: "json", default: { mode: "test" } },
                    {
                        id: "locale",
                        data_type: "enum",
                        default: "zh-CN",
                        options: ["zh-CN", "en-US"],
                    },
                ],
            },
            { id: "disabled", enabled: false },
            { label: "missing-id" },
        ]);

        expect(capabilities).toHaveLength(1);
        expect(capabilities[0].params.map((param) => param.widget)).toEqual([
            "path",
            "textarea",
            "select",
        ]);
        expect(capabilities[0].params[2].options).toEqual([
            { value: "zh-CN", label: "zh-CN" },
            { value: "en-US", label: "en-US" },
        ]);
    });
});
