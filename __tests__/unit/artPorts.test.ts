import { describe, expect, it } from "vitest";
import { getCapabilityInputsForPorts } from "../../src/services/artPorts";
import type { ArtCapability } from "../../src/services/protocol";

const createColorTransferCapability = (): ArtCapability => ({
    id: "custom-color-transfer",
    label: "Color Transfer",
    description: "",
    supported_transports: ["shared_memory"],
    inputs: [
        { name: "input", label: "Source", type: "image" },
        { name: "reference", label: "Reference", type: "image" },
        { name: "strength", label: "Strength", type: "float" } as any,
        { name: "gamma", label: "Gamma", type: "float" } as any,
    ],
    outputs: [{ name: "output", label: "Output", type: "image" }],
    params: [
        { id: "reference", label: "Reference", widget: "image_link", default: "" },
        { id: "strength", label: "Strength", widget: "slider", default: 100, min: 0, max: 100 },
        { id: "gamma", label: "Gamma", widget: "slider", default: 1, min: 0.1, max: 3 },
    ],
});

describe("Art capability port filtering", () => {
    it("keeps only the primary image port when a reference image is also exposed as an image-link param", () => {
        const capability = createColorTransferCapability();

        expect(getCapabilityInputsForPorts(capability).map((input) => input.name)).toEqual([
            "input",
        ]);
    });

    it("keeps secondary image inputs when they are not duplicated by a parameter row", () => {
        const capability = {
            ...createColorTransferCapability(),
            params: createColorTransferCapability().params?.filter((param) => param.id !== "reference"),
        };

        expect(getCapabilityInputsForPorts(capability).map((input) => input.name)).toEqual([
            "input",
            "reference",
        ]);
    });
});
