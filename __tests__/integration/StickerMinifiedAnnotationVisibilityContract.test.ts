import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitImageModelSource = readFileSync(resolve(process.cwd(), "src/components/unitImageModel.ts"), "utf8");
const unitImageContentSource = readFileSync(resolve(process.cwd(), "src/components/UnitStickerImageContent.tsx"), "utf8");
const unitVisualOverlaysSource = readFileSync(resolve(process.cwd(), "src/components/UnitVisualOverlays.tsx"), "utf8");
const stickerEditingFacadeSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditing.ts"), "utf8");
const stickerFrameGeometrySource = readFileSync(resolve(process.cwd(), "src/services/stickerFrameGeometry.ts"), "utf8");

describe("Hook sticker minified annotation visibility contract", () => {
    it("uses a current baked bitmap for fast minified display while retaining the live annotation fallback", () => {
        expect(stickerEditingFacadeSource).toContain("computeMinifiedStickerAnnotationViewport");
        expect(stickerFrameGeometrySource).toContain("export const computeMinifiedStickerAnnotationViewport = (");
        expect(unitImageModelSource).toContain("computeMinifiedStickerAnnotationViewport");
        expect(unitImageModelSource).toContain("resolveCachedBakedSyncPreview");
        expect(unitImageModelSource).toContain("bakedSyncPreviewCacheRevision();");
        expect(unitImageContentSource).toContain('data-sticker-minified-baked-preview="true"');
        expect(unitImageContentSource).toContain('display: props.minifiedBakedPreviewSrc ? "none" : "block"');
        expect(unitImageModelSource).toContain('unit.type !== "sticker"');
        expect(unitVisualOverlaysSource).toContain('class="sticker-annotation-layer-viewport absolute"');
        expect(unitImageContentSource).toContain('class="sticker-rasterized-annotation-layer-viewport absolute"');
    });
});
