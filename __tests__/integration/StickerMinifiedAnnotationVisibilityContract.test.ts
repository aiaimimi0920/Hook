import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const stickerEditingSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditing.ts"), "utf8");

describe("Hook sticker minified annotation visibility contract", () => {
    it("uses a current baked bitmap for fast minified display while retaining the live annotation fallback", () => {
        expect(stickerEditingSource).toContain("export const computeMinifiedStickerAnnotationViewport = (");
        expect(unitViewSource).toContain("computeMinifiedStickerAnnotationViewport");
        expect(unitViewSource).toContain("resolveCachedBakedSyncPreview");
        expect(unitViewSource).toContain("bakedSyncPreviewCacheRevision();");
        expect(unitViewSource).toContain('data-sticker-minified-baked-preview="true"');
        expect(unitViewSource).toContain('display: minifiedBakedPreviewSrc() ? "none" : "block"');
        expect(unitViewSource).toContain('props.unit.type === "sticker"');
        expect(unitViewSource).toContain('class="sticker-annotation-layer-viewport absolute"');
        expect(unitViewSource).toContain('class="sticker-rasterized-annotation-layer-viewport absolute"');
    });
});
