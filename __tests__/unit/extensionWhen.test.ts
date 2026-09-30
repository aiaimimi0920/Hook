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

    it("keeps an unknown context key from enabling a contribution through negation", () => {
        expect(compileExtensionWhen("!future.context.key")(context("sticker", true))).toBe(false);
        expect(compileExtensionWhen('future.context.key != "sticker"')(context("sticker", true))).toBe(false);
        expect(
            compileExtensionWhen("unit.hasImage || !future.context.key")(context("sticker", false)),
        ).toBe(false);
    });

    it("rejects non-boolean values and incompatible comparisons as predicates", () => {
        for (const source of [
            '"sticker"',
            "unit.kind",
            "unit.kind && unit.hasImage",
            "!unit.kind",
            "unit.kind == true",
        ]) {
            expect(() => compileExtensionWhen(source)).toThrow(/boolean|compatible/u);
        }

        expect(compileExtensionWhen("true")(context(null, false))).toBe(true);
        expect(compileExtensionWhen("unit.hasImage")(context("art", true))).toBe(true);
    });
});
