import { describe, expect, it } from "vitest";
import { resolveUnitExecutionInputImage, resolveUnitImageFromGraph } from "../../src/services/graphImageResolution";
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
});
