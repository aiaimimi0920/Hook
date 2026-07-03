import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");

describe("Hook sticker scale contract", () => {
    it("exposes canvas size as a deferred crop property from the top strip property bar", () => {
        expect(propertyBarSource).toContain("MiniDeferredNumericField");
        expect(propertyBarSource).toContain('title="大小"');
        expect(propertyBarSource).toContain("CanvasSizeIcon");
        expect(propertyBarSource).toContain("scaleStickerFrame");
        expect(propertyBarSource).toContain("commitCropCanvasWidthDraft");
    });
});
