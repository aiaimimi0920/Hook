import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const shortcutsSource = readFileSync(resolve(process.cwd(), "src/hooks/useShortcuts.ts"), "utf8");

describe("Hook sticker wheel resize contract", () => {
    it("keeps the minified ctrl+wheel guard, but re-focuses the sticker container after alt-wheel opacity edits so the next ctrl+wheel still works in normal mode", () => {
        expect(unitViewSource).toContain("if (e.ctrlKey) {");
        expect(unitViewSource).toContain("if (isMinified()) return;");
        expect(unitViewSource).toContain("tabIndex={-1}");
        expect(unitViewSource).toContain("e.currentTarget.focus();");
        expect(unitViewSource).toContain("const scaleFactor = 1 - e.deltaY * 0.001;");
        expect(unitViewSource).toContain("props.onOpacityChange(newOp);");
    });

    it("lets ctrl+wheel bubble back to the sticker frame when ctrl+alt+wheel finds no selected annotations, so a prior alt-wheel opacity tweak cannot black-hole the next scale wheel", () => {
        const wheelStart = annotationLayerSource.indexOf("const onWheel = async (event: WheelEvent) => {");
        const preventIndex = annotationLayerSource.indexOf("event.preventDefault();", wheelStart);
        const noSelectionIndex = annotationLayerSource.indexOf('"bubble-no-selection"', wheelStart);
        const noTargetsIndex = annotationLayerSource.indexOf('"bubble-no-targets"', wheelStart);

        expect(wheelStart).toBeGreaterThanOrEqual(0);
        expect(preventIndex).toBeGreaterThanOrEqual(0);
        expect(noSelectionIndex).toBeGreaterThanOrEqual(0);
        expect(noTargetsIndex).toBeGreaterThanOrEqual(0);
        expect(noSelectionIndex).toBeLessThan(preventIndex);
        expect(noTargetsIndex).toBeLessThan(preventIndex);
    });

    it("requires an existing annotation selection before ctrl+alt+wheel can be consumed, so a hovered node cannot hijack the next whole-sticker scale after an alt-wheel opacity tweak", () => {
        const wheelStart = annotationLayerSource.indexOf("const onWheel = async (event: WheelEvent) => {");
        const wheelEnd = annotationLayerSource.indexOf("const draftShapeRect = createMemo(() => {", wheelStart);
        const wheelSource = annotationLayerSource.slice(wheelStart, wheelEnd);

        expect(wheelStart).toBeGreaterThanOrEqual(0);
        expect(wheelEnd).toBeGreaterThan(wheelStart);
        expect(wheelSource).toContain("const annotationIds = currentSelectionIds;");
        expect(wheelSource).not.toContain(": [hit.id]");
    });

    it("suppresses the native bare-Alt accelerator so an alt+wheel opacity edit cannot knock the overlay out of the next ctrl+wheel resize chain", () => {
        expect(shortcutsSource).toContain("const handleKeyUp = (e: KeyboardEvent) => {");
        expect(shortcutsSource).toContain("const shouldSuppressBareAlt = (e: KeyboardEvent) =>");
        expect(shortcutsSource).toContain("e.key === 'Alt' && !e.ctrlKey && !e.metaKey");
        expect(shortcutsSource).toContain("e.stopImmediatePropagation();");
        expect(shortcutsSource).toContain("window.addEventListener('keydown', handleKeyDown, true);");
        expect(shortcutsSource).toContain("window.addEventListener('keyup', handleKeyUp, true);");
        expect(shortcutsSource).toContain("window.removeEventListener('keydown', handleKeyDown, true);");
        expect(shortcutsSource).toContain("window.removeEventListener('keyup', handleKeyUp, true);");
    });
});
