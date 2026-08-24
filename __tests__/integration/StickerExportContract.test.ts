import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const clipboardSource = readFileSync(resolve(process.cwd(), "src/hooks/useClipboard.ts"), "utf8");
const shortcutControllerSource = readFileSync(
    resolve(process.cwd(), "src/hooks/useAppShortcutController.ts"),
    "utf8",
);
const imageResourceApiSource = readFileSync(resolve(process.cwd(), "src/services/apiImageResource.ts"), "utf8");
const exportFacadeSource = readFileSync(resolve(process.cwd(), "src/services/stickerExport.ts"), "utf8");
const annotationDrawingSource = readFileSync(resolve(process.cwd(), "src/services/stickerAnnotationDrawing.ts"), "utf8");
const effectSource = readFileSync(resolve(process.cwd(), "src/services/stickerEffects.ts"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const propertyBarSectionsPath = resolve(process.cwd(), "src/components/stickerTopStripPropertyBarSections.tsx");
const propertyBarSectionsExists = existsSync(propertyBarSectionsPath);
const propertyBarSectionsSource = propertyBarSectionsExists ? readFileSync(propertyBarSectionsPath, "utf8") : "";
const propertyBarRenderSource = `${propertyBarSource}\n${propertyBarSectionsSource}`;

describe("Hook sticker export contract", () => {
    it("routes copy/save of stickers through a composed export image instead of raw src bytes", () => {
        expect(exportFacadeSource).toContain("renderStickerComposite");
        expect(clipboardSource).toContain("await renderStickerComposite(unit)");
        expect(clipboardSource).toContain("api.copyStickerImageToSmartClipboard(");
        expect(clipboardSource).toContain("api.saveStickerImageAs(");
        expect(shortcutControllerSource).toContain("onSave: dependencies.handleSave");
        expect(imageResourceApiSource).toContain("saveStickerImage");
        expect(imageResourceApiSource).toContain('"save_sticker_image"');
        expect(propertyBarRenderSource).toContain('title="重置裁剪"');
        expect(effectSource).toContain("computeEffectSourceProjection");
        expect(effectSource).toContain("renderMosaicToCanvas");
        // Mosaic export paints a non-repeating grid of blue-gray cells (colored by
        // absolute position) that never samples the image, matching the live
        // overlay; blur still renders blurred source pixels.
        expect(annotationDrawingSource).toContain("paintMosaicGrid");
        expect(annotationDrawingSource).toContain("renderBlurToCanvas");
    });
});
