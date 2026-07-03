import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) => {
    const path = resolve(process.cwd(), relativePath);
    return existsSync(path) ? readFileSync(path, "utf8") : "";
};

const annotationLayerSource = readSource("src/components/StickerAnnotationLayer.tsx");
const annotationModelSource = readSource("src/components/stickerAnnotationModel.ts");
const effectOverlaySource = readSource("src/components/StickerEffectOverlay.tsx");

describe("Hook sticker annotation layer split contract", () => {
    it("keeps draft annotation model helpers outside the interactive layer component", () => {
        expect(annotationLayerSource).toContain('from "./stickerAnnotationModel"');
        expect(annotationModelSource).toContain("export type DraftShape");
        expect(annotationModelSource).toContain("export type DraftLine");
        expect(annotationLayerSource).not.toContain("type DraftShape =");
        expect(annotationLayerSource).not.toContain("const normalizeRect =");
    });

    it("keeps mosaic and blur effect rendering outside the pointer interaction layer", () => {
        expect(annotationLayerSource).toContain('from "./StickerEffectOverlay"');
        expect(effectOverlaySource).toContain("export const renderStickerEffectOverlay");
        // Mosaic now paints a pixelated copy of the image as a <pattern> along
        // the brush stroke instead of generating per-tile rects.
        expect(effectOverlaySource).toContain("<pattern");
        expect(effectOverlaySource).toContain("BLUR_EFFECT_OVERLAY_FILL");
        expect(annotationLayerSource).not.toContain("const MosaicEffectOverlay");
        expect(annotationLayerSource).not.toContain("const renderEffectOverlay =");
        expect(annotationLayerSource).toContain("renderStickerEffectOverlay({");
    });
});
