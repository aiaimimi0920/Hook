import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const effectOverlaySource = readFileSync(resolve(process.cwd(), "src/components/StickerEffectOverlay.tsx"), "utf8");

describe("Hook sticker effect controls contract", () => {
    it("exposes manual blur degree and mosaic unit square width controls that feed effect annotation creation", () => {
        expect(propertyBarSource).toContain('settingKey="mosaicSize"');
        expect(propertyBarSource).toContain('settingKey="blurStrength"');
        expect(propertyBarSource).toContain("MiniNumericField");

        expect(annotationLayerSource).toContain("stickerToolSettings.mosaicSize");
        expect(annotationLayerSource).toContain("stickerToolSettings.blurStrength");
    });

    it("paints mosaic/blur as freehand brush strokes with a brush-size control", () => {
        // The mosaic/blur tools are brush-painted: a 笔刷大小 control replaces the
        // old rectangle 外框/边框 width control.
        expect(propertyBarSource).toContain("effectBrushSize");
        expect(propertyBarSource).toContain('title="笔刷"');

        // Effect annotations are committed from a brush draft line, storing the
        // stroke points + brush width alongside the bounding box.
        expect(annotationLayerSource).toContain('line.mode === "mosaic" || line.mode === "blur"');
        expect(annotationLayerSource).toContain("stickerToolSettings.effectBrushSize");
        expect(annotationLayerSource).toContain("points: line.points");
        expect(annotationLayerSource).toContain("brushWidth");
        expect(annotationLayerSource).toContain("renderStickerEffectOverlay");
    });

    it("paints mosaic as a non-repeating cell grid and blur as a pre-blurred image, both stroked along the brush path", () => {
        // Both effects stroke the brush path with a <pattern> so they track the
        // cursor instantly. Mosaic is a grid of square cells colored by their
        // ABSOLUTE position in the sticker (built once per stroke into a sticker-
        // sized PNG via buildMosaicTextureDataUrl), so the grid never repeats and
        // never samples the underlying image — the censored content cannot leak.
        // Blur uses a pattern holding a pre-blurred (feGaussianBlur) copy of the
        // image. No SVG mask, and no backdrop-filter (which lagged behind the cursor).
        expect(effectOverlaySource).toContain("buildStrokePath");
        expect(effectOverlaySource).toContain("stroke-width={props.brushWidth}");
        expect(effectOverlaySource).toContain("<pattern");
        expect(effectOverlaySource).toContain("feGaussianBlur");
        expect(effectOverlaySource).toContain("buildMosaicTextureDataUrl");
        expect(effectOverlaySource).not.toContain("backdrop-filter");
    });
});
