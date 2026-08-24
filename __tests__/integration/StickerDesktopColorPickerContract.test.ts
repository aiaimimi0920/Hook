import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const pickerOverlaySource = readFileSync(
    resolve(process.cwd(), "src/components/StickerDesktopColorPickerOverlay.tsx"),
    "utf8",
);
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");
const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const colorPickerSource = readFileSync(resolve(process.cwd(), "src/components/ColorPicker.tsx"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/store/uiStore.ts"), "utf8");
const imageResourceApiSource = readFileSync(resolve(process.cwd(), "src/services/apiImageResource.ts"), "utf8");
const overlayWindowApiSource = readFileSync(resolve(process.cwd(), "src/services/apiOverlayWindow.ts"), "utf8");
const rustSource = readHookLibRustSources();

describe("Hook desktop color picker contract", () => {
    it("uses desktop color picking only as a color-slot action, not as a standalone tool entry", () => {
        const topStripContractSource = `${topStripSource}\n${propertyBarSource}`;
        expect(topStripContractSource).not.toContain('{ mode: "color-picker", label: "取色" }');
        expect(propertyBarSource).toContain("onPickFromScreen={");
        expect(propertyBarSource).toContain("uiActions.beginStickerScreenColorPick(stickerToolSettings.activeTool)");
        expect(propertyBarSource).toContain("selectedExistingColorRole()");
    });

    it("samples arbitrary desktop coordinates instead of only pixels inside the sticker image", () => {
        expect(imageResourceApiSource).toContain("pickScreenColorAt");
        expect(imageResourceApiSource).toContain('"pick_screen_color_at"');
        expect(rustSource).toContain("fn sample_screen_color_physical");
        expect(rustSource).toContain("fn pick_screen_color_at(");
        expect(rustSource).toContain("GetPixel");

        expect(annotationLayerSource).toContain('interactionEnabled() && stickerToolSettings.activeTool === "color-picker"');
        expect(pickerOverlaySource).toContain("api.setDesktopColorPickerActive(active)");
        expect(pickerOverlaySource).toContain("api.setCaptureInputActive(active)");
        expect(pickerOverlaySource).toContain("createSerializedColorPickerStateQueue");
        expect(pickerOverlaySource).toContain("queueBackendState(true)");
        expect(pickerOverlaySource).toContain('listen<GlobalColorPickerMousePayload>("capture/global_mouse_move"');
        expect(pickerOverlaySource).toContain('listen<GlobalColorPickerMousePayload>("capture/global_mouse_down"');
        expect(pickerOverlaySource).not.toContain("sampleColorFromSticker");
    });

    it("updates desktop color preview directly from global mouse event payload without per-move IPC", () => {
        expect(rustSource).toContain("sample_screen_color_physical(global_x.round() as i32, global_y.round() as i32)");
        expect(rustSource).toContain("DESKTOP_COLOR_PICKER_ACTIVE.load");
        expect(rustSource).toContain('payload["hex"] = serde_json::json!(sample.hex)');
        expect(rustSource).toContain('payload["rgb"] = serde_json::json!(sample.rgb)');
        expect(overlayWindowApiSource).toContain('safeInvoke("set_desktop_color_picker_active"');

        expect(annotationModelSource).toContain("hex?: string");
        expect(annotationModelSource).toContain('rgb?: ScreenColorSample["rgb"]');
        expect(pickerOverlaySource).toContain("payload.hex");
        expect(pickerOverlaySource).toContain("payload.rgb");
        expect(pickerOverlaySource).toContain("normalizeDesktopColorPickerPayload(payload)");
        expect(pickerOverlaySource).toContain("applyDesktopColorPickerSample(event.payload, false, generation)");
        expect(pickerOverlaySource).toContain("applyDesktopColorPickerSample(event.payload, true, generation)");
        expect(pickerOverlaySource).not.toContain("api.pickScreenColorAt(globalX, globalY)");
        expect(pickerOverlaySource).toContain("queueBackendState(false)");
    });

    it("shows a live preview swatch near the picked desktop point", () => {
        expect(pickerOverlaySource).toContain("colorPickerPreview");
        expect(pickerOverlaySource).toContain("setColorPickerPreview");
        expect(pickerOverlaySource).toContain("position: \"fixed\"");
        expect(pickerOverlaySource).toContain("preview.hex");
        expect(pickerOverlaySource).toContain("取色预览");
    });

    it("commits one clicked desktop color and restores the pre-picker tool mode when launched from a color slot", () => {
        const sampleStart = pickerOverlaySource.indexOf("const applyDesktopColorPickerSample");
        const sampleEnd = pickerOverlaySource.indexOf("createEffect(() => {");
        expect(sampleStart).toBeGreaterThan(-1);
        expect(sampleEnd).toBeGreaterThan(sampleStart);
        const sampleSource = pickerOverlaySource.slice(sampleStart, sampleEnd);

        expect(sampleSource).toContain("if (commit) {");
        expect(sampleSource).toContain("committedGeneration === generation");
        expect(sampleSource).toContain("uiActions.setStickerSampledColor(sample.hex);");
        expect(sampleSource).toContain("uiActions.setStickerSampledRgb(sample.rgb);");
        expect(sampleSource).toContain("uiActions.setStickerActiveColor(sample.hex);");
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
        expect(colorPickerSource).toContain("const onSvMouseDown = (event: MouseEvent) => {");
        expect(colorPickerSource).toContain('svPicker?.addEventListener("mousedown", onSvMouseDown);');
        expect(colorPickerSource).toContain("const onHueMouseDown = (event: MouseEvent) => {");
        expect(colorPickerSource).toContain('hueSlider?.addEventListener("mousedown", onHueMouseDown);');
        expect(colorPickerSource).toContain("event.preventDefault();");
        expect(colorPickerSource).toContain("event.stopPropagation();");
    });
});
