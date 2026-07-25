import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarPath = resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx");
const fieldsPath = resolve(process.cwd(), "src/components/stickerTopStripPropertyBarFields.tsx");

const propertyBarSource = readFileSync(propertyBarPath, "utf8");
const fieldsExists = existsSync(fieldsPath);
const fieldsSource = fieldsExists ? readFileSync(fieldsPath, "utf8") : "";

describe("Hook sticker top strip property bar fields extraction contract", () => {
    it("keeps reusable mini field primitives in a dedicated helper module instead of redefining them inline in the property bar", () => {
        expect(fieldsExists).toBe(true);
        expect(fieldsSource).toContain("export const createStickerTopStripPropertyBarFields =");
        expect(fieldsSource).toContain("export type MiniNumericFieldComponent = Component<");
        expect(fieldsSource).toContain("export type MiniDeferredNumericFieldComponent = Component<");
        expect(fieldsSource).toContain("export type MiniDropdownFieldComponent = Component<");
        expect(fieldsSource).toContain("export type MiniColorFieldComponent = Component<");
        expect(fieldsSource).toContain("export type MiniFontFieldComponent = Component<");
        expect(fieldsSource).toContain("const MiniNumericField: MiniNumericFieldComponent =");
        expect(fieldsSource).toContain("const MiniDeferredNumericField: MiniDeferredNumericFieldComponent =");
        expect(fieldsSource).toContain("const MiniDropdownField: MiniDropdownFieldComponent =");
        expect(fieldsSource).toContain("return {");
        expect(fieldsSource).toContain("MiniNumericField");
        expect(fieldsSource).toContain("MiniDeferredNumericField");
        expect(fieldsSource).toContain("MiniDropdownField");
        expect(propertyBarSource).toContain('from "./stickerTopStripPropertyBarFields"');
        expect(propertyBarSource).toContain("createStickerTopStripPropertyBarFields({");
        expect(propertyBarSource).not.toContain("const MiniNumericField: Component<");
        expect(propertyBarSource).not.toContain("const MiniDeferredNumericField: Component<");
        expect(propertyBarSource).not.toContain("const MiniDropdownField: Component<");
    });
});
