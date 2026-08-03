import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const selectionSource = readFileSync(resolve(process.cwd(), "src/hooks/useSelection.ts"), "utf8");
const canvasSelectionSource = readFileSync(resolve(process.cwd(), "src/components/CanvasSelection.tsx"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");

const sliceFunctionBlock = (startMarker: string, endMarker: string) => {
    const start = rustSource.indexOf(startMarker);
    const end = rustSource.indexOf(endMarker, start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    return rustSource.slice(start, end);
};

describe("capture focus preservation contract", () => {
    it("does not force Hook to take foreground focus when entering region capture mode", () => {
        const block = sliceFunctionBlock("fn enter_capture_mode", "fn enter_long_capture_mode");

        expect(block).toContain("show_overlay_host_impl(window, true);");
        expect(block).not.toContain("window.set_focus()");
    });

    it("does not force Hook to take foreground focus when entering long capture mode", () => {
        const block = sliceFunctionBlock("fn enter_long_capture_mode", "fn encode_rgb_image_as_capture_response");

        expect(block).toContain("show_overlay_host_impl(window, true);");
        expect(block).not.toContain("window.set_focus()");
    });

    it("keeps ordinary region capture from hiding the Hook overlay or flashing a visible composition overlay", () => {
        expect(selectionSource).not.toContain("await api.hideToTray()");
        expect(selectionSource).not.toContain("await api.showOverlayHost(true)");
        expect(selectionSource).not.toContain("CAPTURE_OVERLAY_HIDE_SETTLE_MS");
        expect(selectionSource).not.toContain("setHoldCaptureCompositionOverlay(true)");
        expect(selectionSource).not.toContain("compositionOverlayAlpha: CAPTURE_COMPOSITION_OVERLAY_ALPHA");
        expect(canvasSelectionSource).not.toContain("holdCaptureCompositionOverlay");
        expect(canvasSelectionSource).not.toContain("rgba(0, 0, 0, 0.01)");
    });

    it("does not focus sticker DOM nodes during ordinary sticker mouse interactions", () => {
        expect(unitViewSource).not.toContain("event.currentTarget.focus();");
        expect(unitViewSource).not.toContain("e.currentTarget.focus();");
    });

    it("hands foreground focus to Hook only after a capture was successfully added and selected", () => {
        const addCaptureStart = selectionSource.indexOf("const addCaptureUnit = async");
        const addCaptureEnd = selectionSource.indexOf("const describeLongCaptureAnalysis", addCaptureStart);

        expect(addCaptureStart).toBeGreaterThan(-1);
        expect(addCaptureEnd).toBeGreaterThan(addCaptureStart);

        const addCaptureBlock = selectionSource.slice(addCaptureStart, addCaptureEnd);
        const addUnitIndex = addCaptureBlock.indexOf("graphStore.actions.addUnit(newUnit);");
        const selectIndex = addCaptureBlock.indexOf("selectionActions.set([newUnit.id]);");
        const focusIndex = addCaptureBlock.indexOf("await api.focusOverlayWindow();");

        expect(addUnitIndex).toBeGreaterThan(-1);
        expect(selectIndex).toBeGreaterThan(addUnitIndex);
        expect(focusIndex).toBeGreaterThan(selectIndex);
    });
});
