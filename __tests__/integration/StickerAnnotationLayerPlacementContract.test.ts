import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");

describe("Hook sticker annotation layer placement contract", () => {
    it("renders the sticker annotation layer inside the clipped sticker-visual container so bounded shapes cannot visibly spill outside the sticker", () => {
        const visualStart = unitViewSource.indexOf('<div class="sticker-visual"');
        const firstAnnotationLayer = unitViewSource.indexOf("<StickerAnnotationLayer");
        const selectionBorderStart = unitViewSource.indexOf('<Show when={!isMinified() && !isCleanView()}>');

        expect(visualStart).toBeGreaterThanOrEqual(0);
        expect(firstAnnotationLayer).toBeGreaterThan(visualStart);
        expect(selectionBorderStart).toBeGreaterThan(firstAnnotationLayer);
    });
});
