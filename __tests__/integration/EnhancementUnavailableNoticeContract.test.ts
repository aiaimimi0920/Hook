import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("enhancement unavailable notice contract", () => {
    const unitActionsSource = readSource("src/hooks/useUnitActions.ts");
    const unitOverlaysSource = readSource("src/components/UnitVisualOverlays.tsx");
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

        expect(unitOverlaysSource).toContain("enhancementNotices");
        expect(unitOverlaysSource).toContain("enhancement-notice");
        expect(unitOverlaysSource).toContain("uiActions.dismissEnhancementNotice(props.unit.id)");
        expect(unitOverlaysSource).toContain("event.stopPropagation()");
    });
});
