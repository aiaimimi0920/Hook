import { describe, expect, it } from "vitest";

import { validateExtensionJsonValue } from "../../src/services/unitExtensionValidation";
import { denseOcrAttachmentPayload } from "../fixtures/denseOcrAttachment";

describe("extension attachment JSON budgets", () => {
    it("preserves a byte-bounded OCR page including all character geometry and visual blocks", () => {
        const payload = denseOcrAttachmentPayload();
        expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThan(256 * 1024);
        expect(payload.textBlocks.flatMap((block) => block.characterSpans).length).toBeGreaterThan(450);

        const validated = validateExtensionJsonValue(payload);
        expect(validated).toEqual(payload);
        expect(validated).not.toBe(payload);
    });

    it("enforces the existing UTF-8 byte limit, including multibyte text", () => {
        const maximumString = "x".repeat(256 * 1024 - 2);
        expect(validateExtensionJsonValue(maximumString)).toBe(maximumString);
        expect(() => validateExtensionJsonValue(`${maximumString}x`)).toThrow("byte budget");
        expect(() => validateExtensionJsonValue("\u4e2d".repeat(90_000))).toThrow("byte budget");
    });

    it("bounds traversal of deep, cyclic, and excessively wide input", () => {
        let nested: unknown = null;
        for (let index = 0; index < 33; index += 1) nested = [nested];
        expect(() => validateExtensionJsonValue(nested)).toThrow("JSON budget");
        const cycle: unknown[] = [];
        cycle.push(cycle);
        expect(() => validateExtensionJsonValue(cycle)).toThrow("JSON budget");
        expect(() => validateExtensionJsonValue(Array.from({ length: 131_072 }, () => 0))).toThrow("JSON budget");
    });

    it.each([NaN, Infinity, undefined, new Date()])("rejects non-JSON values: %s", (value) => {
        expect(() => validateExtensionJsonValue({ value })).toThrow();
    });
});
