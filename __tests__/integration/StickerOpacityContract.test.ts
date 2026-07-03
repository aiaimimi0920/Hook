import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const exportSource = readFileSync(resolve(process.cwd(), "src/services/stickerExport.ts"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");

describe("Hook sticker opacity contract", () => {
    it("exposes opacity as a deferred numeric crop property and keeps export composition aligned with sticker opacity", () => {
        expect(propertyBarSource).toContain("MiniDeferredNumericField");
        expect(propertyBarSource).toContain('title="透明度"');
        expect(propertyBarSource).toContain("commitCropOpacityDraft");
        expect(propertyBarSource).toContain("OpacityIcon");

        expect(unitViewSource).toContain("opacityNormal");
        expect(unitViewSource).toContain("opacityMini");

        expect(exportSource).toContain("opacityNormal");
        expect(exportSource).toContain("globalAlpha");
    });
});
