import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const propertyBarSectionsPath = resolve(process.cwd(), "src/components/stickerTopStripPropertyBarSections.tsx");
const propertyBarSectionsExists = existsSync(propertyBarSectionsPath);
const propertyBarSectionsSource = propertyBarSectionsExists ? readFileSync(propertyBarSectionsPath, "utf8") : "";
const propertyBarCropSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerTopStripPropertyBarCropController.ts"),
    "utf8",
);
const propertyBarRenderSource = `${propertyBarSource}\n${propertyBarSectionsSource}\n${propertyBarCropSource}`;
const unitImageModelSource = readFileSync(resolve(process.cwd(), "src/components/unitImageModel.ts"), "utf8");
const unitImageContentSource = readFileSync(resolve(process.cwd(), "src/components/UnitStickerImageContent.tsx"), "utf8");
const exportSource = readFileSync(resolve(process.cwd(), "src/services/stickerCompositeRenderer.ts"), "utf8");

describe("Hook sticker border contract", () => {
    it("wires a user-facing border control through runtime rendering and export composition", () => {
        expect(propertyBarRenderSource).toContain('title="边框开关"');
        expect(propertyBarRenderSource).toContain("toggleStickerBorder");

        expect(unitImageModelSource).toContain("borderWidth");
        expect(unitImageModelSource).toContain("borderColor");
        expect(unitImageContentSource).toContain("props.imageBorderWidth");
        expect(unitImageContentSource).toContain("props.imageBorderColor");

        expect(exportSource).toContain("borderWidth");
        expect(exportSource).toContain("borderColor");
        expect(exportSource).toContain("strokeRect");
    });
});
