import { describe, expect, it } from "vitest";

import {
    extractArtDeliveryValueOutputs,
    mergeArtDeliveryOutputs,
} from "../../src/services/artDeliveryOutputs";

describe("extractArtDeliveryValueOutputs", () => {
    it("1. uses the delivered value as output", () => {
        expect(extractArtDeliveryValueOutputs({ value: 42 })).toEqual({ output: 42 });
    });

    it("2. falls back to data when value is undefined", () => {
        expect(extractArtDeliveryValueOutputs({ data: "D" })).toEqual({ output: "D" });
    });

    it("3. falls back to data when value is null (nullish coalescing)", () => {
        expect(extractArtDeliveryValueOutputs({ value: null, data: "D" })).toEqual({ output: "D" });
    });

    it("4. merges an explicit outputs map alongside the derived output", () => {
        expect(
            extractArtDeliveryValueOutputs({ value: "V", outputs: { extra: 1 } }),
        ).toEqual({ output: "V", extra: 1 });
    });

    it("5. lets an explicit outputs.output override the derived one", () => {
        expect(
            extractArtDeliveryValueOutputs({ value: "V", outputs: { output: "O" } }),
        ).toEqual({ output: "O" });
    });

    it("6. keeps a falsy-but-present value (0) rather than falling back to data", () => {
        expect(extractArtDeliveryValueOutputs({ value: 0, data: "D" })).toEqual({ output: 0 });
    });
});

describe("mergeArtDeliveryOutputs", () => {
    it("7. preserves existing outputs and layers fresh value outputs on top", () => {
        expect(
            mergeArtDeliveryOutputs({
                currentOutputs: { keep: 1, output: "old" },
                valueOutputs: { output: "new" },
            }),
        ).toEqual({ keep: 1, output: "new" });
    });

    it("8. sets both output and output_image from previewSrc, overriding value outputs", () => {
        expect(
            mergeArtDeliveryOutputs({
                valueOutputs: { output: "scalar" },
                previewSrc: "data:img",
            }),
        ).toEqual({ output: "data:img", output_image: "data:img" });
    });

    it("9. sets file_path from filePath", () => {
        expect(mergeArtDeliveryOutputs({ filePath: "/tmp/a.png" })).toEqual({
            file_path: "/tmp/a.png",
        });
    });

    it("10. returns just the merged value/current outputs when there is no image or file", () => {
        expect(
            mergeArtDeliveryOutputs({ currentOutputs: { a: 1 }, valueOutputs: { b: 2 } }),
        ).toEqual({ a: 1, b: 2 });
    });

    it("11. returns an empty map when nothing is provided", () => {
        expect(mergeArtDeliveryOutputs({})).toEqual({});
    });

    it("12. applies both previewSrc and filePath together", () => {
        expect(
            mergeArtDeliveryOutputs({ previewSrc: "data:img", filePath: "/tmp/a.png" }),
        ).toEqual({ output: "data:img", output_image: "data:img", file_path: "/tmp/a.png" });
    });
});
