import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const topStripPath = resolve(process.cwd(), "src/components/StickerTopStrip.tsx");
const catalogPath = resolve(process.cwd(), "src/components/stickerTopStripCatalog.tsx");

const topStripSource = readFileSync(topStripPath, "utf8");
const catalogExists = existsSync(catalogPath);
const catalogSource = catalogExists ? readFileSync(catalogPath, "utf8") : "";

describe("Hook sticker top strip catalog extraction contract", () => {
    it("keeps top strip tool option catalogs and type guards in a dedicated helper module instead of redefining them inline in StickerTopStrip", () => {
        expect(catalogExists).toBe(true);
        expect(catalogSource).toContain("export type ShapeCreateTool =");
        expect(catalogSource).toContain("export type LabelCreateTool =");
        expect(catalogSource).toContain("export type EffectCreateTool =");
        expect(catalogSource).toContain("export const transformModeOptions");
        expect(catalogSource).toContain("export const shapeToolOptions");
        expect(catalogSource).toContain("export const historyActionOptions");
        expect(catalogSource).toContain("export const rasterizeScopeOptions");
        expect(catalogSource).toContain("export const isShapeTool =");
        expect(catalogSource).toContain("export const isLabelTool =");
        expect(catalogSource).toContain("export const isEffectTool =");
        expect(topStripSource).toContain('from "./stickerTopStripCatalog"');
        expect(topStripSource).not.toContain("const transformModeOptions: TransformModeOption[] = [");
        expect(topStripSource).not.toContain("const shapeToolOptions: CreateToolOption<ShapeCreateTool>[] = [");
        expect(topStripSource).not.toContain("const historyActionOptions: HistoryActionOption[] = [");
        expect(topStripSource).not.toContain('const isShapeTool = (value: StickerCreateTool): value is ShapeCreateTool =>');
    });
});
