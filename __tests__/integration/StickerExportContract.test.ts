import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const clipboardSource = readFileSync(resolve(process.cwd(), "src/hooks/useClipboard.ts"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "src/services/api.ts"), "utf8");
const exportSource = readFileSync(resolve(process.cwd(), "src/services/stickerExport.ts"), "utf8");
const effectSource = readFileSync(resolve(process.cwd(), "src/services/stickerEffects.ts"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");

describe("Hook sticker export contract", () => {
    it("routes copy/save of stickers through a composed export image instead of raw src bytes", () => {
        expect(exportSource).toContain("renderStickerComposite");
        expect(clipboardSource).toContain("await renderStickerComposite(unit)");
        expect(clipboardSource).toContain("api.copyStickerImageToSmartClipboard(exportBase64)");
        expect(clipboardSource).toContain("api.saveStickerImageAs(exportBase64");
        expect(appSource).toContain("onSave: handleSave");
        expect(apiSource).toContain("saveStickerImage");
        expect(apiSource).toContain('"save_sticker_image"');
        expect(propertyBarSource).toContain('title="重置裁剪"');
        expect(effectSource).toContain("computeEffectSourceProjection");
        expect(effectSource).toContain("renderMosaicToCanvas");
        // Mosaic export paints a non-repeating grid of blue-gray cells (colored by
        // absolute position) that never samples the image, matching the live
        // overlay; blur still renders blurred source pixels.
        expect(exportSource).toContain("paintMosaicGrid");
        expect(exportSource).toContain("renderBlurToCanvas");
    });
});
