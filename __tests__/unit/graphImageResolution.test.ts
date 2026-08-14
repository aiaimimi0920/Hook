import { describe, expect, it } from "vitest";
import {
    resolveAuxiliaryUnitExecutionInputImages,
    resolveConnectedUnitImageForPort,
    resolveMissingUnitExecutionImagePorts,
    resolveEffectiveNodeParams,
    resolveUnitExecutionImageInputs,
    isUnitFormalImagePending,
    resolveUnitExecutionInputImage,
    resolveUnitImageFromGraph,
    resolveUnitOutputValue,
} from "../../src/services/graphImageResolution";
import type { ArtCapability } from "../../src/services/protocol";
import type { Link, Unit } from "../../src/types/unit";

const sticker = (id: string, data: Unit["data"]): Unit => ({
    id,
    type: "sticker",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    params: {},
    inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }],
    outputs: [{ id: "output", type: "image", direction: "output", label: "Image" }],
    data,
});

describe("graph image resolution", () => {
    it("blocks formal export through an untouched sticker while its upstream Art is processing", () => {
        const upstream: Unit = {
            id: "processing-art",
            type: "art",
            artId: "workflow-art",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            params: {},
            inputs: [],
            outputs: [{ id: "output", type: "image", direction: "output" }],
            data: {
                processing: true,
                outputs: { output: "data:image/png;base64,STALE_FORMAL" },
            },
        };
        const downstream = sticker("downstream", {});
        const links: Link[] = [{
            id: "art-to-sticker",
            fromUnitId: upstream.id,
            fromPortId: "output",
            toUnitId: downstream.id,
            toPortId: "image",
        }];

        expect(isUnitFormalImagePending({
            units: [upstream, downstream],
            links,
            unitId: downstream.id,
        })).toBe(true);

        upstream.data.processing = false;
        upstream.data.nodeStatus = "completed";
        expect(isUnitFormalImagePending({
            units: [upstream, downstream],
            links,
            unitId: downstream.id,
        })).toBe(false);
    });

    it("treats a locally edited sticker as an independent formal export boundary", () => {
        const upstream: Unit = {
            ...sticker("processing-source", {}),
            type: "art",
            data: { processing: true },
        };
        const downstream = sticker("edited-downstream", {
            stickerEditPropagation: { locallyEdited: true },
        });
        const links: Link[] = [{
            id: "art-to-edited-sticker",
            fromUnitId: upstream.id,
            fromPortId: "output",
            toUnitId: downstream.id,
            toPortId: "image",
        }];

        expect(isUnitFormalImagePending({
            units: [upstream, downstream],
            links,
            unitId: downstream.id,
        })).toBe(false);
    });

    it("resolves a sticker's connected input before its stale local preview", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source" }),
            sticker("target", {
                src: "data:image/png;base64,target-original",
                previewSrc: "data:image/png;base64,target-stale-preview",
            }),
        ];
        const links: Link[] = [
            {
                id: "link-source-target",
                fromUnitId: "source",
                fromPortId: "output",
                toUnitId: "target",
                toPortId: "image",
            },
        ];

        expect(resolveUnitImageFromGraph({ units, links, unitId: "target" })).toBe("data:image/png;base64,source");
    });

    it("resolves through an intermediate sticker so downstream art nodes receive the effective image", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source" }),
            sticker("middle", { src: "data:image/png;base64,middle-original" }),
        ];
        const links: Link[] = [
            {
                id: "link-source-middle",
                fromUnitId: "source",
                fromPortId: "output",
                toUnitId: "middle",
                toPortId: "image",
            },
        ];

        expect(resolveUnitImageFromGraph({ units, links, unitId: "middle" })).toBe("data:image/png;base64,source");
    });

    it("resolves an art node execution image from its connected image input instead of its old preview", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source" }),
            {
                id: "removebg",
                type: "art",
                artId: "custom-removebg",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {},
                inputs: [{ id: "input", type: "image", direction: "input", label: "input" }],
                outputs: [{ id: "output", type: "image", direction: "output", label: "output" }],
                data: { previewSrc: "data:image/png;base64,old-removebg-result" },
            },
        ];
        const links: Link[] = [
            {
                id: "link-source-removebg",
                fromUnitId: "source",
                fromPortId: "output_image",
                toUnitId: "removebg",
                toPortId: "input",
            },
        ];

        expect(
            resolveUnitExecutionInputImage({
                units,
                links,
                unitId: "removebg",
                capabilities: [
                    {
                        id: "custom-removebg",
                        label: "RemoveBG",
                        description: "",
                        supported_transports: ["shared_memory"],
                        params: [],
                        inputs: [{ name: "input", label: "input", type: "image" }],
                        outputs: [{ name: "output", label: "output", type: "image" }],
                    },
                ],
            }),
        ).toBe("data:image/png;base64,source");
    });

    it("rejects an undeclared input_image alias when the capability declares input", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source" }),
            {
                id: "removebg",
                type: "art",
                artId: "custom-removebg",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {},
                inputs: [{ id: "input", type: "image", direction: "input", label: "input" }],
                outputs: [{ id: "output", type: "image", direction: "output", label: "output" }],
                data: {},
            },
        ];
        const links: Link[] = [
            {
                id: "legacy-link-source-removebg",
                fromUnitId: "source",
                fromPortId: "output_image",
                toUnitId: "removebg",
                toPortId: "input_image",
            },
        ];

        expect(
            resolveUnitExecutionInputImage({
                units,
                links,
                unitId: "removebg",
                capabilities: [
                    {
                        id: "custom-removebg",
                        label: "RemoveBG",
                        description: "",
                        supported_transports: ["shared_memory"],
                        params: [],
                        inputs: [{ name: "input", label: "input", type: "image" }],
                        outputs: [{ name: "output", label: "output", type: "image" }],
                    },
                ],
            }),
        ).toBeUndefined();
    });

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

    it("chooses the connected image input for execution when a node also has non-image links", () => {
        const units: Unit[] = [
            sticker("text-like-source", { src: "data:image/png;base64,wrong" }),
            sticker("image-source", { src: "data:image/png;base64,right" }),
            {
                id: "removebg",
                type: "art",
                artId: "custom-removebg",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {},
                inputs: [
                    { id: "bg_color", type: "text", direction: "input", label: "bg_color" },
                    { id: "input", type: "image", direction: "input", label: "input" },
                ],
                outputs: [{ id: "output", type: "image", direction: "output", label: "output" }],
                data: {},
            },
        ];
        const links: Link[] = [
            {
                id: "link-text",
                fromUnitId: "text-like-source",
                fromPortId: "output_image",
                toUnitId: "removebg",
                toPortId: "bg_color",
            },
            {
                id: "link-image",
                fromUnitId: "image-source",
                fromPortId: "output_image",
                toUnitId: "removebg",
                toPortId: "input",
            },
        ];

        expect(
            resolveUnitExecutionInputImage({
                units,
                links,
                unitId: "removebg",
                capabilities: [
                    {
                        id: "custom-removebg",
                        label: "RemoveBG",
                        description: "",
                        supported_transports: ["shared_memory"],
                        params: [],
                        inputs: [
                            { name: "bg_color", label: "bg_color", type: "text" },
                            { name: "input", label: "input", type: "image" },
                        ],
                    },
                ],
            }),
        ).toBe("data:image/png;base64,right");
    });

    it("resolves a connected shader image port from the upstream execution image instead of a middle sticker's saved preview frame", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source-100x100" }),
            sticker("middle", {
                src: "data:image/png;base64,middle-original",
                previewSrc: "data:image/png;base64,middle-saved-200x100-preview",
            }),
            {
                id: "color-transfer",
                type: "art",
                artId: "custom-1770131241684",
                x: 0,
                y: 0,
                w: 200,
                h: 100,
                params: {},
                inputs: [
                    { id: "input", type: "image", direction: "input", label: "input" },
                    { id: "reference", type: "image", direction: "input", label: "reference" },
                ],
                outputs: [{ id: "output", type: "image", direction: "output", label: "output" }],
                data: {},
            },
        ];
        const links: Link[] = [
            {
                id: "link-source-middle",
                fromUnitId: "source",
                fromPortId: "output",
                toUnitId: "middle",
                toPortId: "image",
            },
            {
                id: "link-middle-color-transfer",
                fromUnitId: "middle",
                fromPortId: "output",
                toUnitId: "color-transfer",
                toPortId: "input",
            },
        ];

        expect(
            resolveConnectedUnitImageForPort({
                units,
                links,
                unitId: "color-transfer",
                portId: "input",
            }),
        ).toBe("data:image/png;base64,source-100x100");
    });

    it("collects auxiliary linked image inputs for true multi-image art execution", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source-main" }),
            sticker("reference-source", { src: "data:image/png;base64,source-reference" }),
            {
                id: "image-blend",
                type: "art",
                artId: "custom-image-blend-script",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {
                    reference: "",
                },
                inputs: [
                    { id: "input", type: "image", direction: "input", label: "input" },
                    { id: "reference", type: "image", direction: "input", label: "reference" },
                ],
                outputs: [{ id: "output", type: "image", direction: "output", label: "output" }],
                data: {},
            },
        ];
        const links: Link[] = [
            {
                id: "link-source-main",
                fromUnitId: "source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "input",
            },
            {
                id: "link-source-reference",
                fromUnitId: "reference-source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "reference",
            },
        ];

        expect(
            resolveAuxiliaryUnitExecutionInputImages({
                units,
                links,
                unitId: "image-blend",
                capabilities: [
                    {
                        id: "custom-image-blend-script",
                        label: "图片混合",
                        description: "",
                        supported_transports: ["shared_memory"],
                        params: [
                            { id: "reference", label: "参考图", widget: "image_link", default: "" },
                            { id: "mix_ratio", label: "混合比例", widget: "slider", default: 50, min: 0, max: 100 },
                        ],
                        inputs: [
                            { name: "input", label: "源图", type: "image" },
                            { name: "reference", label: "参考图", type: "image", exposePort: true } as any,
                        ],
                        outputs: [{ name: "output", label: "结果", type: "image" }],
                    },
                ],
            }),
        ).toEqual({
            reference: "data:image/png;base64,source-reference",
        });
    });

    it("keeps generated input_2 workflow ports mapped to the second connected image", () => {
        const units: Unit[] = [
            sticker("main-source", { src: "data:image/png;base64,main-image" }),
            sticker("reference-source", { src: "data:image/png;base64,reference-image" }),
            {
                id: "workflow-art",
                type: "art",
                artId: "hook-wf-color-transfer-compress",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {},
                inputs: [
                    { id: "input", type: "image", direction: "input", label: "input" },
                    { id: "input_2", type: "image", direction: "input", label: "input_2" },
                ],
                outputs: [{ id: "output", type: "image", direction: "output", label: "output" }],
                data: {},
            },
        ];
        const links: Link[] = [
            {
                id: "link-main",
                fromUnitId: "main-source",
                fromPortId: "output",
                toUnitId: "workflow-art",
                toPortId: "input",
            },
            {
                id: "link-reference",
                fromUnitId: "reference-source",
                fromPortId: "output_image",
                toUnitId: "workflow-art",
                toPortId: "input_2",
            },
        ];
        const capabilities: ArtCapability[] = [
            {
                id: "hook-wf-color-transfer-compress",
                label: "颜色迁移+压缩",
                description: "",
                supported_transports: ["shared_memory"],
                params: [],
                inputs: [
                    { name: "input", label: "主输入", type: "image" },
                    { name: "input_2", label: "参考图", type: "image", exposePort: true },
                ],
                outputs: [{ name: "output", label: "结果", type: "image" }],
            },
        ];

        expect(
            resolveUnitExecutionInputImage({
                units,
                links,
                unitId: "workflow-art",
                capabilities,
            }),
        ).toBe("data:image/png;base64,main-image");
        expect(
            resolveAuxiliaryUnitExecutionInputImages({
                units,
                links,
                unitId: "workflow-art",
                capabilities,
            }),
        ).toEqual({
            input_2: "data:image/png;base64,reference-image",
        });
    });

    it("rejects undeclared auxiliary image links when the capability catalog is unavailable", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source-main" }),
            sticker("reference-source", { src: "data:image/png;base64,source-reference" }),
            {
                id: "image-blend",
                type: "art",
                artId: "custom-image-blend-script",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {},
                inputs: [{ id: "input_image", type: "image", direction: "input", label: "input_image" }],
                outputs: [{ id: "output_image", type: "image", direction: "output", label: "output_image" }],
                data: {},
            },
        ];
        const links: Link[] = [
            {
                id: "link-source-main",
                fromUnitId: "source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "input_image",
            },
            {
                id: "link-source-reference",
                fromUnitId: "reference-source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "reference",
            },
        ];

        expect(
            resolveAuxiliaryUnitExecutionInputImages({
                units,
                links,
                unitId: "image-blend",
                capabilities: [],
            }),
        ).toEqual({});
    });

    it("rejects an auxiliary image link omitted from both capability and unit ports", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source-main" }),
            sticker("reference-source", { src: "data:image/png;base64,source-reference" }),
            {
                id: "image-blend",
                type: "art",
                artId: "custom-image-blend-script",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {
                    reference: "",
                    mix_ratio: 50,
                },
                inputs: [{ id: "input_image", type: "image", direction: "input", label: "input_image" }],
                outputs: [{ id: "output_image", type: "image", direction: "output", label: "output_image" }],
                data: {},
            },
        ];
        const links: Link[] = [
            {
                id: "link-source-main",
                fromUnitId: "source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "input_image",
            },
            {
                id: "link-source-reference",
                fromUnitId: "reference-source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "reference",
            },
        ];

        expect(
            resolveAuxiliaryUnitExecutionInputImages({
                units,
                links,
                unitId: "image-blend",
                capabilities: [
                    {
                        id: "custom-image-blend-script",
                        label: "图片混合",
                        description: "",
                        supported_transports: ["shared_memory"],
                        params: [
                            { id: "reference", label: "参考图", widget: "image_link", default: "" },
                            { id: "mix_ratio", label: "混合比例", widget: "slider", default: 50, min: 0, max: 100 },
                        ],
                    },
                ],
            }),
        ).toEqual({});
    });

    it("ignores non-image-like incoming param links during the capability-missing fallback", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source-main" }),
            sticker("color-source", { src: "data:image/png;base64,should-not-be-treated-as-image-param" }),
            {
                id: "image-blend",
                type: "art",
                artId: "custom-image-blend-script",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {},
                inputs: [{ id: "input_image", type: "image", direction: "input", label: "input_image" }],
                outputs: [{ id: "output_image", type: "image", direction: "output", label: "output_image" }],
                data: {},
            },
        ];
        const links: Link[] = [
            {
                id: "link-source-main",
                fromUnitId: "source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "input_image",
            },
            {
                id: "link-bg-color",
                fromUnitId: "color-source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "bg_color",
            },
        ];

        expect(
            resolveAuxiliaryUnitExecutionInputImages({
                units,
                links,
                unitId: "image-blend",
                capabilities: [],
            }),
        ).toEqual({});
    });

    it("reports missing required image ports for auto execution until all declared image inputs are available", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source-main" }),
            {
                id: "image-blend",
                type: "art",
                artId: "custom-image-blend-script",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {
                    reference: "",
                    mix_ratio: 50,
                },
                inputs: [
                    { id: "input", type: "image", direction: "input", label: "input" },
                    { id: "reference", type: "image", direction: "input", label: "reference" },
                ],
                outputs: [{ id: "output", type: "image", direction: "output", label: "output" }],
                data: {},
            },
        ];
        const links: Link[] = [
            {
                id: "link-source-main",
                fromUnitId: "source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "input",
            },
        ];

        expect(
            resolveMissingUnitExecutionImagePorts({
                units,
                links,
                unitId: "image-blend",
                capabilities: [
                    {
                        id: "custom-image-blend-script",
                        label: "图片混合",
                        description: "",
                        supported_transports: ["shared_memory"],
                        params: [
                            { id: "reference", label: "参考图", widget: "image_link", default: "" },
                            { id: "mix_ratio", label: "混合比例", widget: "slider", default: 50, min: 0, max: 100 },
                        ],
                        inputs: [
                            { name: "input", label: "源图", type: "image" },
                            { name: "reference", label: "参考图", type: "image", exposePort: true } as any,
                        ],
                        outputs: [{ name: "output", label: "结果", type: "image" }],
                    },
                ],
            }),
        ).toEqual(["reference"]);
    });

    it("requires only the explicitly declared unit image port when capabilities omit inputs", () => {
        const units: Unit[] = [
            sticker("source", { src: "data:image/png;base64,source-main" }),
            sticker("reference-source", { src: "data:image/png;base64,source-reference" }),
            {
                id: "image-blend",
                type: "art",
                artId: "custom-image-blend-script",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {
                    reference: "",
                },
                inputs: [{ id: "input_image", type: "image", direction: "input", label: "input_image" }],
                outputs: [{ id: "output_image", type: "image", direction: "output", label: "output_image" }],
                data: {},
            },
        ];
        const links: Link[] = [
            {
                id: "link-source-main",
                fromUnitId: "source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "input_image",
            },
            {
                id: "link-source-reference",
                fromUnitId: "reference-source",
                fromPortId: "output",
                toUnitId: "image-blend",
                toPortId: "reference",
            },
        ];

        expect(
            resolveMissingUnitExecutionImagePorts({
                units,
                links,
                unitId: "image-blend",
                capabilities: [
                    {
                        id: "custom-image-blend-script",
                        label: "图片混合",
                        description: "",
                        supported_transports: ["shared_memory"],
                        params: [
                            { id: "reference", label: "参考图", widget: "image_link", default: "" },
                            { id: "mix_ratio", label: "混合比例", widget: "slider", default: 50, min: 0, max: 100 },
                        ],
                    },
                ],
            }),
        ).toEqual([]);
    });

    it("keeps a workflow Art preview out of its formal output port", () => {
        const units: Unit[] = [
            {
                id: "workflow-art",
                type: "art",
                artId: "hook-wf-color-transfer-compress",
                x: 0,
                y: 0,
                w: 100,
                h: 100,
                params: {},
                inputs: [],
                outputs: [{ id: "output", type: "image", direction: "output" }],
                data: { previewSrc: "data:image/png;base64,shader-preview" },
            },
        ];

        expect(
            resolveUnitOutputValue({
                units,
                links: [],
                unitId: "workflow-art",
                portId: "output",
            }),
        ).toBeUndefined();

        units[0].data.outputs = {
            output: "data:image/png;base64,compressed-formal",
        };

        expect(
            resolveUnitOutputValue({
                units,
                links: [],
                unitId: "workflow-art",
                portId: "output",
            }),
        ).toBe("data:image/png;base64,compressed-formal");
    });

    it("uses a workflow Art's formal output as downstream Art execution input", () => {
        const workflowArt: Unit = {
            id: "workflow-art",
            type: "art",
            artId: "hook-wf-color-transfer-compress",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            params: {},
            inputs: [],
            outputs: [{ id: "output", type: "image", direction: "output" }],
            data: { previewSrc: "data:image/png;base64,shader-preview" },
        };
        const downstreamArt: Unit = {
            id: "downstream-art",
            type: "art",
            artId: "custom-removebg",
            x: 120,
            y: 0,
            w: 100,
            h: 100,
            params: {},
            inputs: [{ id: "input", type: "image", direction: "input" }],
            outputs: [{ id: "output", type: "image", direction: "output" }],
            data: {},
        };
        const units = [workflowArt, downstreamArt];
        const links: Link[] = [
            {
                id: "workflow-to-downstream",
                fromUnitId: "workflow-art",
                fromPortId: "output",
                toUnitId: "downstream-art",
                toPortId: "input",
            },
        ];

        expect(
            resolveUnitExecutionInputImage({
                units,
                links,
                unitId: "downstream-art",
            }),
        ).toBeUndefined();

        workflowArt.data.outputs = {
            output: "data:image/png;base64,compressed-formal",
        };

        expect(
            resolveUnitExecutionInputImage({
                units,
                links,
                unitId: "downstream-art",
            }),
        ).toBe("data:image/png;base64,compressed-formal");
    });
});
