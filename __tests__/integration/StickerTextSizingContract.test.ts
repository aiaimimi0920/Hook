import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const toolbarModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerToolbarModel.ts"), "utf8");
const toolbarContractSource = `${topStripSource}\n${propertyBarSource}\n${toolbarModelSource}`;
const appSource = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const exportSource = readFileSync(resolve(process.cwd(), "src/services/stickerExport.ts"), "utf8");
const typeSource = readFileSync(resolve(process.cwd(), "src/types/stickerEditing.ts"), "utf8");
const stickerEditingSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditing.ts"), "utf8");
const mutationSource = readFileSync(resolve(process.cwd(), "src/services/stickerAnnotationMutations.ts"), "utf8");
const apiSource = readFileSync(resolve(process.cwd(), "src/services/api.ts"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/store/uiStore.ts"), "utf8");
const fontCatalogSource = readFileSync(resolve(process.cwd(), "src/services/fontCatalog.ts"), "utf8");
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");

describe("Hook sticker text sizing contract", () => {
    it("stores font size on text annotations and exposes direct text size controls", () => {
        expect(typeSource).toContain("fontSize?: number");
        expect(toolbarContractSource).toContain('| "textSize"');
        expect(propertyBarSource).toContain('title="字号"');
        expect(propertyBarSource).toContain('settingKey="textSize"');
        expect(propertyBarSource).toContain("currentValue={stickerToolSettings.textSize}");
        expect(annotationLayerSource).toContain("fontSize: existing?.fontSize ?? stickerToolSettings.textSize");
        expect(annotationLayerSource).toContain("fontSize: draft.fontSize");
        expect(annotationLayerSource).toContain("font-size={text().fontSize");
        expect(exportSource).toContain("text.fontSize");
    });

    it("uses the shared color-slot palette for text color instead of the generic active color controls", () => {
        expect(typeSource).toContain("textColor: string");
        expect(stickerEditingSource).toContain('textColor: "#ef4444"');
        expect(propertyBarSource).toContain('<MiniColorField title="文字颜色" slot="textColor" Icon={TextIcon} />');
        expect(propertyBarSource).toContain("<ColorPicker");
        expect(propertyBarSource).not.toContain("renderColorControls");
        expect(annotationLayerSource).toContain("color: existing?.style.color ?? stickerToolSettings.textColor");
        expect(annotationLayerSource).toContain("color: draft.color");
        expect(annotationLayerSource).not.toContain("color: getEffectiveStickerColor(stickerColorState)");
    });

    it("creates text through an inline input near the clicked text position instead of a blocking prompt", () => {
        expect(annotationLayerSource).toContain("pendingTextInput");
        expect(annotationLayerSource).toContain("commitPendingTextInput");
        expect(annotationLayerSource).toContain("setPendingTextInput({");
        expect(annotationLayerSource).toContain('aria-label="输入标注文本"');
        expect(annotationLayerSource).toContain("pendingTextInputStyle()");
        expect(annotationLayerSource).toContain("onKeyDown={(event) => handlePendingTextInputKeyDown(event)}");
        expect(annotationLayerSource).not.toContain('window.prompt("输入标注文本"');
    });

    it("renders the text draft through the same SVG text renderer while the user types", () => {
        expect(annotationLayerSource).toContain("pendingTextPreviewAnnotation");
        expect(annotationLayerSource).toContain("<Show when={pendingTextPreviewAnnotation()}");
        expect(annotationLayerSource).toContain("visiblePreviewAnnotations");
        expect(annotationLayerSource).toContain('color: "transparent"');
        expect(annotationLayerSource).toContain('"caret-color": draft.color');
        expect(annotationLayerSource).toContain("draft.y - draft.fontSize");
        expect(annotationLayerSource).toContain("top: `${top}px`");
    });

    it("keeps the pending SVG preview bound to the live text accessor instead of the first typed snapshot", () => {
        expect(annotationLayerSource).toContain("const renderTextAnnotation = (text: Accessor<StickerTextAnnotation>)");
        expect(annotationLayerSource).toContain("text().text");
        expect(annotationLayerSource).toContain("text().fontSize");
        expect(annotationLayerSource).not.toContain("renderTextAnnotation(preview())");
    });

    it("keys the pending SVG text preview so every typed character remounts the current draft value", () => {
        expect(annotationLayerSource).toContain("<Show when={pendingTextPreviewAnnotation()} keyed>");
        expect(annotationLayerSource).toContain("{(preview) => renderTextAnnotation(() => preview)}");
        expect(annotationLayerSource).not.toContain("{(preview) => renderTextAnnotation(preview)}");
    });

    it("stores per-node font families and keeps separate default fonts for text and serial tools", () => {
        expect(typeSource).toContain("fontFamily?: string");
        expect(typeSource).toContain("textFontFamily: string");
        expect(typeSource).toContain("serialFontFamily: string");
        expect(stickerEditingSource).toContain('textFontFamily: "微软雅黑"');
        expect(stickerEditingSource).toContain('serialFontFamily: "微软雅黑"');
        expect(uiStoreSource).toContain("patchStickerToolSettings");
        expect(annotationLayerSource).toContain("fontFamily: resolveTextAnnotationFontFamily(existing)");
        expect(annotationLayerSource).toContain("fontFamily: stickerToolSettings.serialFontFamily");
        expect(annotationLayerSource).toContain("fontFamily: draft.fontFamily");
        expect(annotationLayerSource).toContain("font-family={text().fontFamily");
        expect(exportSource).toContain("text.fontFamily");
        expect(mutationSource).toContain("updateTextAnnotationFontFamilyById");
    });

    it("drives a font dropdown from preset fonts plus installed system fonts", () => {
        expect(fontCatalogSource).toContain("COMMON_STICKER_FONT_FAMILIES");
        expect(fontCatalogSource).toContain("mergeStickerFontFamilies");
        expect(appSource).toMatch(/api\s*\.\s*getInstalledFonts\(\)/);
        expect(appSource).toContain("setInstalledStickerFonts(fonts)");
        expect(propertyBarSource).toContain("availableFontFamilies");
        expect(propertyBarSource).toContain("value={stickerToolSettings.textFontFamily}");
        expect(propertyBarSource).toContain("value={stickerToolSettings.serialFontFamily}");
        expect(propertyBarSource).toContain('title="字体"');
        expect(propertyBarSource).toContain('updateTextAnnotationFontFamilyById');
        expect(apiSource).toContain("getInstalledFonts");
        expect(rustSource).toContain("get_installed_fonts");
    });

    it("shows the actual font for a selected text or serial node without overwriting the next default font", () => {
        expect(topStripSource).toContain("resolveSelectedExistingNodePropertyTool");
        expect(propertyBarSource).toContain("selectedExistingTextFontFamily");
        expect(propertyBarSource).toContain("selectedExistingSerialFontFamily");
        expect(propertyBarSource).toContain('title="节点字体"');
        expect(propertyBarSource).toContain('applySelectedAnnotationFontFamilyChange("text", value)');
        expect(propertyBarSource).toContain('applySelectedAnnotationFontFamilyChange("serial", value)');
        expect(annotationLayerSource).toContain(
            'const resolveTextAnnotationFontFamily = (annotation?: StickerTextAnnotation) =>',
        );
    });

    it("gives selected text and serial nodes four-corner resize handles in Q mode", () => {
        expect(annotationLayerSource).toContain("const beginDirectTransform = (");
        expect(annotationLayerSource).toContain('const textAnnotation = value as StickerTextAnnotation;');
        expect(annotationLayerSource).toContain("const bounds = getAnnotationBounds(textAnnotation);");
        expect(annotationLayerSource).toContain('<Show when={stickerToolSettings.transformMode === "select"}>');
        expect(annotationLayerSource).toContain("<For each={getBoundsHandlePoints(bounds)}>");
        expect(annotationLayerSource).toContain('beginDirectTransform(event, [value], "scale", { axis: "xy" })');
    });
});
