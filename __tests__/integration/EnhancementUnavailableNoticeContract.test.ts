import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("enhancement unavailable notice contract", () => {
    const unitActionsSource = readSource("src/hooks/useUnitActions.ts");
    const unitViewSource = readSource("src/components/UnitView.tsx");
    const uiStoreSource = readSource("src/store/uiStore.ts");

    it("does not use native alert for missing OCR or translation enhancements because Hook click-through blocks it", () => {
        expect(unitActionsSource).not.toContain("window.alert");
        expect(unitActionsSource).not.toContain(".alert(");
        expect(unitActionsSource).toContain("uiActions.showEnhancementNotice");
    });

    it("renders a unit-bound, clickable enhancement notice inside the related sticker/art node", () => {
        expect(uiStoreSource).toContain("enhancementNotices");
        expect(uiStoreSource).toContain("showEnhancementNotice");
        expect(uiStoreSource).toContain("dismissEnhancementNotice");

        expect(unitViewSource).toContain("enhancementNotices");
        expect(unitViewSource).toContain("enhancement-notice");
        expect(unitViewSource).toContain("uiActions.dismissEnhancementNotice(props.unit.id)");
        expect(unitViewSource).toContain("event.stopPropagation()");
    });
});
