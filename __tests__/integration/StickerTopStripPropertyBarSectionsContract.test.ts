import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarPath = resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx");
const sectionsPath = resolve(process.cwd(), "src/components/stickerTopStripPropertyBarSections.tsx");

const propertyBarSource = readFileSync(propertyBarPath, "utf8");
const sectionsExists = existsSync(sectionsPath);
const sectionsSource = sectionsExists ? readFileSync(sectionsPath, "utf8") : "";

describe("Hook sticker top strip property bar sections extraction contract", () => {
    it("keeps tool-specific section renderers in a dedicated helper module instead of redefining them inline in the property bar", () => {
        expect(sectionsExists).toBe(true);
        expect(sectionsSource).toContain("export const createStickerTopStripPropertyBarSections =");
        expect(sectionsSource).toContain("const renderShapeFields = () => (");
        expect(sectionsSource).toContain("const renderLineFields = () => (");
        expect(sectionsSource).toContain("const renderBrushFields = () => (");
        expect(sectionsSource).toContain("const renderSelectedTextFields = () => (");
        expect(sectionsSource).toContain("const renderSelectedSerialFields = () => (");
        expect(sectionsSource).toContain("const renderCropFields = () => (");
        expect(sectionsSource).toContain("return {");
        expect(sectionsSource).toContain("renderEffectFields");
        expect(sectionsSource).toContain("renderCropFields");
        expect(propertyBarSource).toContain('from "./stickerTopStripPropertyBarSections"');
        expect(propertyBarSource).toContain("createStickerTopStripPropertyBarSections({");
        expect(propertyBarSource).not.toContain("const renderShapeFields = () => (");
        expect(propertyBarSource).not.toContain("const renderLineFields = () => (");
        expect(propertyBarSource).not.toContain("const renderCropFields = () => (");
    });
});
