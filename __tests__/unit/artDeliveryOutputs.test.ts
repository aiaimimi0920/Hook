import { describe, expect, it, vi } from "vitest";

import {
    extractArtDeliveryValueOutputs,
    materializeSharedMemoryOutputs,
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

describe("materializeSharedMemoryOutputs", () => {
    it("materializes secondary shared-memory ports when the primary output is scalar", async () => {
        const readSharedMemory = vi.fn(async (handle: string) => `data:${handle}`);
        await expect(
            materializeSharedMemoryOutputs({
                outputs: {
                    output: 42,
                    thumbnail: {
                        type: "shared_memory",
                        handle: "Loom_Buffer_secondary",
                        size: 8,
                        width: 2,
                        height: 1,
                        format: "rgba8",
                    },
                },
                readSharedMemory,
            }),
        ).resolves.toEqual({
            output: 42,
            thumbnail: "data:Loom_Buffer_secondary",
        });
        expect(readSharedMemory).toHaveBeenCalledWith("Loom_Buffer_secondary", 8, 2, 1);
    });

    it("reuses an already materialized primary handle and reads other ports", async () => {
        const readSharedMemory = vi.fn(async (handle: string) => `data:${handle}`);
        const descriptor = (handle: string) => ({
            type: "shared_memory",
            handle,
            size: 4,
            width: 1,
            height: 1,
            format: "rgba8",
        });
        await expect(
            materializeSharedMemoryOutputs({
                outputs: {
                    output_image: descriptor("Loom_Buffer_primary"),
                    mask: descriptor("Loom_Buffer_mask"),
                },
                primaryHandle: "Loom_Buffer_primary",
                primaryData: "data:primary",
                readSharedMemory,
            }),
        ).resolves.toEqual({
            output_image: "data:primary",
            mask: "data:Loom_Buffer_mask",
        });
        expect(readSharedMemory).toHaveBeenCalledTimes(1);
        expect(readSharedMemory).toHaveBeenCalledWith("Loom_Buffer_mask", 4, 1, 1);
    });

    it("rejects malformed or non-canonical shared-memory descriptors", async () => {
        const readSharedMemory = vi.fn(async () => "unused");
        await expect(
            materializeSharedMemoryOutputs({
                outputs: {
                    mask: {
                        type: "shared_memory",
                        handle: "legacy-buffer",
                        size: 4,
                        width: 1,
                        height: 1,
                        format: "rgba8",
                    },
                },
                readSharedMemory,
            }),
        ).rejects.toThrow("invalid shared-memory output for port mask");
        expect(readSharedMemory).not.toHaveBeenCalled();
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
