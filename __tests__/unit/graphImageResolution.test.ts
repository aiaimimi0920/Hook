import { describe, expect, it } from "vitest";
import {
    resolveAuxiliaryUnitExecutionInputImages,
    resolveConnectedUnitImageForPort,
    resolveMissingUnitExecutionImagePorts,
    resolveUnitExecutionInputImage,
    resolveUnitImageFromGraph,
} from "../../src/services/graphImageResolution";
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

    it("keeps resolving legacy art links that used input_image before capabilities exposed input", () => {
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
        ).toBe("data:image/png;base64,source");
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

    it("falls back to legacy image-like incoming links when the art capability catalog is unavailable", () => {
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
        ).toEqual({
            reference: "data:image/png;base64,source-reference",
        });
    });

    it("falls back to legacy auxiliary image links when a capability exists but its handshake omitted inputs", () => {
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
        ).toEqual({
            reference: "data:image/png;base64,source-reference",
        });
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

    it("treats legacy reference links as satisfying required auxiliary image ports even when capabilities omit inputs", () => {
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
});
