import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const topStripPath = resolve(process.cwd(), "src/components/StickerTopStrip.tsx");
const iconsPath = resolve(process.cwd(), "src/components/stickerTopStripIcons.tsx");

const topStripSource = readFileSync(topStripPath, "utf8");
const iconsExists = existsSync(iconsPath);
const iconsSource = iconsExists ? readFileSync(iconsPath, "utf8") : "";

describe("Hook sticker top strip icon extraction contract", () => {
    it("keeps reusable top strip toolbar icons in a dedicated helper module instead of redefining them inline in StickerTopStrip", () => {
        expect(iconsExists).toBe(true);
        expect(iconsSource).toContain("export interface TopStripIconProps");
        expect(iconsSource).toContain("export const SelectModeIcon");
        expect(iconsSource).toContain("export const BrushToolIcon");
        expect(iconsSource).toContain("export const RasterizeSelectedToolIcon");
        expect(iconsSource).toContain("export const ChevronDownCornerIcon");
        expect(topStripSource).toContain('from "./stickerTopStripIcons"');
        expect(topStripSource).not.toContain("const SelectModeIcon: Component<TopStripIconProps>");
        expect(topStripSource).not.toContain("const BrushToolIcon: Component<TopStripIconProps>");
        expect(topStripSource).not.toContain("const RasterizeSelectedToolIcon: Component<TopStripIconProps>");
        expect(topStripSource).not.toContain("const ChevronDownCornerIcon: Component<TopStripIconProps>");
    });
});
