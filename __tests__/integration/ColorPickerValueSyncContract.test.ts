import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(process.cwd(), "src/components/ColorPicker.tsx"),
    "utf8",
);

describe("ColorPicker external-value sync contract", () => {
    it("re-syncs the internal HSV state whenever the parent value changes", () => {
        expect(source).toContain("const syncFromExternalValue = (nextValue: string) => {");
        expect(source).toContain("let lastSyncedExternalValue: string | undefined;");
        expect(source).toContain("if (nextValue === lastSyncedExternalValue) return;");
        expect(source).toContain("syncFromExternalValue(nextValue);");
        expect(source).toContain("if (!untrack(hexEditing)) {");
        expect(source).toContain("setHexDraft(nextValue);");
    });

    it("throttles backend rect sync so color picker resize callbacks do not spam IPC", () => {
        expect(source).toContain("let rectSyncRaf: number | null = null;");
        expect(source).toContain("if (rectSyncRaf !== null) return;");
        expect(source).toContain("lastSyncedRect");
        expect(source).toContain("window.cancelAnimationFrame(rectSyncRaf);");
    });

    it("drags alpha through a manual overlay-safe track instead of a native range input", () => {
        expect(source).toContain("let alphaSliderRef: HTMLDivElement | undefined;");
        expect(source).toContain("const handleAlphaPick = (event: MouseEvent) => {");
        expect(source).toContain("let alphaDragging = false;");
        expect(source).toContain("if (alphaDragging) handleAlphaPick(event);");
        expect(source).toContain('alphaSliderRef.addEventListener("mousedown", (event) => {');
        expect(source).toContain("data-alpha-slider");
        expect(source).not.toContain('type="range"');
    });
});
