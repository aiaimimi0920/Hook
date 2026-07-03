import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const exportSource = readFileSync(resolve(process.cwd(), "src/services/stickerExport.ts"), "utf8");

describe("Hook sticker border contract", () => {
    it("wires a user-facing border control through runtime rendering and export composition", () => {
        expect(propertyBarSource).toContain('title="边框开关"');
        expect(propertyBarSource).toContain("toggleStickerBorder");

        expect(unitViewSource).toContain("borderWidth");
        expect(unitViewSource).toContain("borderColor");

        expect(exportSource).toContain("borderWidth");
        expect(exportSource).toContain("borderColor");
        expect(exportSource).toContain("strokeRect");
    });
});
