import { describe, expect, it, vi } from "vitest";

import {
    parseUnitImageDataUrl,
    resolveUnitImageDataUrl,
} from "../../src/services/unitImageSource";

describe("unit image source", () => {
    it("returns parsed MIME and decoded length for bounded Base64 images", () => {
        expect(parseUnitImageDataUrl("data:image/png;base64,AA==", 1)).toEqual({
            dataUrl: "data:image/png;base64,AA==",
            mime: "image/png",
            dataBase64: "AA==",
            byteLength: 1,
        });
    });

    it("applies the byte limit to inline and native-reader results", async () => {
        const oversized = "data:image/png;base64,AAAA";
        expect(() => parseUnitImageDataUrl(oversized, 2)).toThrow("2-byte limit");
        await expect(resolveUnitImageDataUrl(
            { src: "C:\\capture.png", filePath: "C:\\capture.png" },
            { readImageFromPath: vi.fn(async () => oversized) },
            2,
        )).rejects.toThrow("2-byte limit");
    });

    it("rejects non-Base64 data URLs before bridge serialization", () => {
        expect(() => parseUnitImageDataUrl("data:image/png,not-base64"))
            .toThrow("supported Base64 data URL");
        expect(() => parseUnitImageDataUrl("data:image/png;base64,A==="))
            .toThrow("supported Base64 data URL");
        expect(() => parseUnitImageDataUrl("data:image/png;base64,AAA"))
            .toThrow("canonical Base64 data");
    });
});
