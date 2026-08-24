import { describe, expect, it } from "vitest";
import { resolveMissingUnitExecutionImagePorts } from "../../src/services/graphImageResolution";
import type { Link, Unit } from "../../src/types/unit";
import { sticker } from "./graphImageResolutionTestFixtures";

describe("graph image resolution: missing image ports", () => {
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

});
