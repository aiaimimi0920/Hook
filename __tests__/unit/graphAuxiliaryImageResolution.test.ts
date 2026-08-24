import { describe, expect, it } from "vitest";
import {
    resolveAuxiliaryUnitExecutionInputImages,
    resolveUnitExecutionInputImage,
} from "../../src/services/graphImageResolution";
import type { ArtCapability } from "../../src/services/protocol";
import type { Link, Unit } from "../../src/types/unit";
import { sticker } from "./graphImageResolutionTestFixtures";

describe("graph image resolution: auxiliary images", () => {
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

});
