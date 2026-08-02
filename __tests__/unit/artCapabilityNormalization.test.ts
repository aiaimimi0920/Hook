import { describe, expect, it } from "vitest";
import { normalizeArtCapabilities } from "../../src/services/artCapabilityNormalization";
import { findArtCapability } from "../../src/services/artCapabilityLookup";

describe("Loom Art capability normalization", () => {
    it("normalizes current framework Art manifests without dropping package metadata", () => {
        const [capability] = normalizeArtCapabilities([
            {
                id: "color-transfer",
                name: "Color Transfer",
                description: null,
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
                        executionType: "image_buffer",
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
                params: [
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
                    art: {
                        qualifiedId: "publisher.example/color-transfer",
                    },
                    capabilities: {
                        preview: "image",
                    },
                },
            },
        ]);

        expect(capability).toMatchObject({
            id: "publisher.example/color-transfer",
            legacyId: "color-transfer",
            qualifiedId: "publisher.example/color-transfer",
            label: "Color Transfer",
            description: "",
            supported_transports: ["shared_memory"],
            execution_type: "framework_art",
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
        expect(findArtCapability([capability], "color-transfer")).toBe(capability);
        expect(findArtCapability([capability], "publisher.example/color-transfer")).toBe(capability);
    });

    it("keeps legacy aliases while filling safe defaults", () => {
        const [capability] = normalizeArtCapabilities([
            {
                art_id: "legacy-art",
                name: "Legacy Art",
                autoProcess: true,
                executionType: "workflow",
            },
        ]);

        expect(capability).toEqual(expect.objectContaining({
            id: "legacy-art",
            label: "Legacy Art",
            description: "",
            auto_process: true,
            execution_type: "workflow",
            params: [],
            supported_transports: ["shared_memory"],
        }));
    });

    it("derives publisher-qualified identity from package security metadata", () => {
        const [capability] = normalizeArtCapabilities([
            {
                id: "shared-art",
                name: "Shared Art",
                metadata: {
                    packageSecurity: {
                        publisher: { id: "publisher.alpha" },
                    },
                },
            },
        ]);

        expect(capability.id).toBe("publisher.alpha/shared-art");
        expect(capability.legacyId).toBe("shared-art");
    });

    it("infers new parameter widgets and filters disabled or invalid Arts", () => {
        const capabilities = normalizeArtCapabilities([
            {
                id: "layout-test",
                name: "Layout",
                params: [
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
            { name: "missing-id" },
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
