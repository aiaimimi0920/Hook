import { describe, expect, it } from "vitest";

import { compileExtensionWhen, type ExtensionWhenContext } from "../../src/services/extensionWhen";

const context = (kind: "sticker" | "art" | null, hasImage: boolean): ExtensionWhenContext => ({
    unit: { kind, hasImage },
    attachmentTypes: new Set(["text.ocr"]),
});

describe("compileExtensionWhen", () => {
    it("evaluates the bounded supported grammar without dynamic code execution", () => {
        const predicate = compileExtensionWhen(
            'unit.kind == "sticker" && unit.hasImage && attachment.has("text.ocr")',
        );

        expect(predicate(context("sticker", true))).toBe(true);
        expect(predicate(context("art", true))).toBe(false);
        expect(compileExtensionWhen("!unit.hasImage || unit.kind != 'art'")(context("sticker", false))).toBe(true);
    });

    it("treats unknown context keys as false and rejects malformed expressions", () => {
        expect(compileExtensionWhen("future.context.key")(context("sticker", true))).toBe(false);
        expect(() => compileExtensionWhen("unit.kind &&&& unit.hasImage")).toThrow(/value|token/u);
        expect(() => compileExtensionWhen("(".repeat(20) + "true" + ")".repeat(20))).toThrow(/depth/u);
        expect(() => compileExtensionWhen("globalThis.alert('unsafe')")).toThrow(/trailing|requires/u);
    });
});
