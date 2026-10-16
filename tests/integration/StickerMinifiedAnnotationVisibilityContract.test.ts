import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitImageModelSource = readFileSync(resolve(process.cwd(), "src/features/workspace/components/unitImageModel.ts"), "utf8");
const unitImageContentSource = readFileSync(resolve(process.cwd(), "src/features/workspace/components/UnitStickerImageContent.tsx"), "utf8");
const unitVisualOverlaysSource = readFileSync(resolve(process.cwd(), "src/features/workspace/components/UnitVisualOverlays.tsx"), "utf8");
const stickerEditingFacadeSource = readFileSync(resolve(process.cwd(), "src/features/stickers/services/stickerEditing.ts"), "utf8");
const stickerFrameGeometrySource = readFileSync(resolve(process.cwd(), "src/features/stickers/services/stickerFrameGeometry.ts"), "utf8");

describe("Otter sticker minified annotation visibility contract", () => {
    it("keeps the live full-size layers independent of the synchronization preview cache", () => {
        expect(stickerEditingFacadeSource).toContain("computeMinifiedStickerAnnotationViewport");
        expect(stickerFrameGeometrySource).toContain("export const computeMinifiedStickerAnnotationViewport = (");
        expect(unitImageModelSource).toContain("computeMinifiedStickerAnnotationViewport");
        expect(unitImageModelSource).not.toContain("syncImageCache");
        expect(unitImageContentSource).not.toContain("minifiedBakedPreview");
        expect(unitVisualOverlaysSource).not.toContain("minifiedBakedPreview");
        expect(unitImageModelSource).toContain('unit.type !== "sticker"');
        expect(unitVisualOverlaysSource).toContain('class="sticker-annotation-layer-viewport absolute"');
        expect(unitImageContentSource).toContain('class="sticker-rasterized-annotation-layer-viewport absolute"');
    });
});
