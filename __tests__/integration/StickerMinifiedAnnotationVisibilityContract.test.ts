import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const stickerEditingSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditing.ts"), "utf8");

describe("Hook sticker minified annotation visibility contract", () => {
    it("keeps annotation overlays mounted and offset-cropped during double-click minify instead of dropping them entirely", () => {
        expect(stickerEditingSource).toContain("export const computeMinifiedStickerAnnotationViewport = (");
        expect(unitViewSource).toContain("computeMinifiedStickerAnnotationViewport");
        expect(unitViewSource).not.toContain('<Show when={!isMinified() && props.unit.type === "sticker"}>');
        expect(unitViewSource).toContain('class="sticker-annotation-layer-viewport absolute"');
        expect(unitViewSource).toContain('class="sticker-rasterized-annotation-layer-viewport absolute"');
    });
});
