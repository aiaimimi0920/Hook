import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const propertyBarSectionsPath = resolve(process.cwd(), "src/components/stickerTopStripPropertyBarSections.tsx");
const propertyBarSectionsExists = existsSync(propertyBarSectionsPath);
const propertyBarSectionsSource = propertyBarSectionsExists ? readFileSync(propertyBarSectionsPath, "utf8") : "";
const propertyBarRenderSource = `${propertyBarSource}\n${propertyBarSectionsSource}`;

describe("Hook sticker scale contract", () => {
    it("exposes canvas size as a deferred crop property from the top strip property bar", () => {
        expect(propertyBarRenderSource).toContain("MiniDeferredNumericField");
        expect(propertyBarRenderSource).toContain('title="大小"');
        expect(propertyBarRenderSource).toContain("CanvasSizeIcon");
        expect(propertyBarRenderSource).toContain("scaleStickerFrame");
        expect(propertyBarRenderSource).toContain("commitCropCanvasWidthDraft");
    });
});
