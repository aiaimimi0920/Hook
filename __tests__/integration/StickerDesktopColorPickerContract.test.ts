import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");
const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const colorPickerSource = readFileSync(resolve(process.cwd(), "src/components/ColorPicker.tsx"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/store/uiStore.ts"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "src/services/api.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("Hook desktop color picker contract", () => {
    it("uses desktop color picking only as a color-slot action, not as a standalone tool entry", () => {
        const topStripContractSource = `${topStripSource}\n${propertyBarSource}`;
        expect(topStripContractSource).not.toContain('{ mode: "color-picker", label: "取色" }');
        expect(propertyBarSource).toContain("onPickFromScreen={");
        expect(propertyBarSource).toContain("uiActions.beginStickerScreenColorPick(stickerToolSettings.activeTool)");
        expect(propertyBarSource).toContain("selectedExistingColorRole()");
    });

    it("samples arbitrary desktop coordinates instead of only pixels inside the sticker image", () => {
        expect(apiSource).toContain("pickScreenColorAt");
        expect(apiSource).toContain('"pick_screen_color_at"');
        expect(rustSource).toContain("fn sample_screen_color_physical");
        expect(rustSource).toContain("fn pick_screen_color_at(");
        expect(rustSource).toContain("GetPixel");

        expect(annotationLayerSource).toContain('interactionEnabled() && stickerToolSettings.activeTool === "color-picker"');
        expect(annotationLayerSource).toContain("api.setCaptureInputActive(true)");
        expect(annotationLayerSource).toContain('listen<GlobalColorPickerMousePayload>("capture/global_mouse_move"');
        expect(annotationLayerSource).toContain('listen<GlobalColorPickerMousePayload>("capture/global_mouse_down"');
        expect(annotationLayerSource).not.toContain("sampleColorFromSticker");
    });

    it("updates desktop color preview directly from global mouse event payload without per-move IPC", () => {
        expect(rustSource).toContain("sample_screen_color_physical(global_x.round() as i32, global_y.round() as i32)");
        expect(rustSource).toContain('"hex": sample.hex');
        expect(rustSource).toContain('"rgb": sample.rgb');

        expect(annotationModelSource).toContain("hex?: string");
        expect(annotationModelSource).toContain('rgb?: ScreenColorSample["rgb"]');
        expect(annotationLayerSource).toContain("payload.hex");
        expect(annotationLayerSource).toContain("payload.rgb");
        expect(annotationLayerSource).toContain("applyDesktopColorPickerSample(event.payload, false)");
        expect(annotationLayerSource).toContain("applyDesktopColorPickerSample(event.payload, true)");
        expect(annotationLayerSource).not.toContain("api.pickScreenColorAt(globalX, globalY)");
    });

    it("shows a live preview swatch near the picked desktop point", () => {
        expect(annotationLayerSource).toContain("colorPickerPreview");
        expect(annotationLayerSource).toContain("setColorPickerPreview");
        expect(annotationLayerSource).toContain("position: \"fixed\"");
        expect(annotationLayerSource).toContain("preview.hex");
        expect(annotationLayerSource).toContain("取色预览");
    });

    it("commits one clicked desktop color and restores the pre-picker tool mode when launched from a color slot", () => {
        const sampleStart = annotationLayerSource.indexOf("const applyDesktopColorPickerSample");
        const sampleEnd = annotationLayerSource.indexOf("const toLocalPoint");
        expect(sampleStart).toBeGreaterThan(-1);
        expect(sampleEnd).toBeGreaterThan(sampleStart);
        const sampleSource = annotationLayerSource.slice(sampleStart, sampleEnd);

        expect(sampleSource).toContain("if (commit) {");
        expect(sampleSource).toContain("uiActions.setStickerSampledColor(payload.hex);");
        expect(sampleSource).toContain("uiActions.setStickerSampledRgb(payload.rgb);");
        expect(sampleSource).toContain("uiActions.setStickerActiveColor(payload.hex);");
        expect(sampleSource).toContain("const returnTool = uiActions.consumeStickerColorPickerReturnMode();");
        expect(sampleSource).toContain("if (returnTool) {");
        expect(sampleSource).toContain("uiActions.setStickerActiveTool(returnTool);");
        expect(sampleSource).not.toContain("setStickerEditMode");

        expect(uiStoreSource).toContain("beginStickerScreenColorPick");
        expect(uiStoreSource).toContain("consumeStickerColorPickerReturnMode");
        expect(propertyBarSource).toContain("uiActions.beginStickerScreenColorPick(stickerToolSettings.activeTool)");
    });

    it("blocks mousedown leakage from the floating picker so drag gestures do not fall through and move the sticker underneath", () => {
        expect(colorPickerSource).toContain('onMouseDown={(e) => e.stopPropagation()}');
        expect(colorPickerSource).toContain('svPickerRef.addEventListener("mousedown", (event) => {');
        expect(colorPickerSource).toContain('hueSliderRef.addEventListener("mousedown", (event) => {');
        expect(colorPickerSource).toContain("event.preventDefault();");
        expect(colorPickerSource).toContain("event.stopPropagation();");
    });
});
