import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const propertyBarSectionsPath = resolve(process.cwd(), "src/components/stickerTopStripPropertyBarSections.tsx");
const propertyBarSectionsExists = existsSync(propertyBarSectionsPath);
const propertyBarSectionsSource = propertyBarSectionsExists ? readFileSync(propertyBarSectionsPath, "utf8") : "";
const propertyBarRenderSource = `${propertyBarSource}\n${propertyBarSectionsSource}`;
const propertyBarSelectionSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerTopStripPropertyBarSelectionController.ts"),
    "utf8",
);
const installedFontLoaderSource = readFileSync(
    resolve(process.cwd(), "src/services/installedStickerFontLoader.ts"),
    "utf8",
);
const toolbarModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerToolbarModel.ts"), "utf8");
const toolbarContractSource = `${topStripSource}\n${propertyBarRenderSource}\n${toolbarModelSource}`;
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const textControllerSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationTextController.ts"),
    "utf8",
);
const pointerDownSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationPointerDownController.ts"),
    "utf8",
);
const viewModelSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationViewModel.tsx"),
    "utf8",
);
const selectionOverlaySource = readFileSync(
    resolve(process.cwd(), "src/components/StickerAnnotationSelectionOverlay.tsx"),
    "utf8",
);
const exportSource = readFileSync(resolve(process.cwd(), "src/services/stickerAnnotationDrawing.ts"), "utf8");
const textGeometrySource = readFileSync(resolve(process.cwd(), "src/services/stickerTextGeometry.ts"), "utf8");
const typeSource = readFileSync(resolve(process.cwd(), "src/types/stickerEditing.ts"), "utf8");
const stickerEditingDefaultsSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditingDefaults.ts"), "utf8");
const mutationSource = readFileSync(resolve(process.cwd(), "src/services/stickerAnnotationMutations.ts"), "utf8");
const bootSettingsApiSource = readFileSync(resolve(process.cwd(), "src/services/apiBootSettings.ts"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/store/uiStore.ts"), "utf8");
const fontCatalogSource = readFileSync(resolve(process.cwd(), "src/services/fontCatalog.ts"), "utf8");
const rustSource = readHookLibRustSources();

describe("Hook sticker text sizing contract", () => {
    it("stores font size on text annotations and exposes direct text size controls", () => {
        expect(typeSource).toContain("fontSize?: number");
        expect(toolbarContractSource).toContain('| "textSize"');
        expect(propertyBarRenderSource).toContain('title="字号"');
        expect(propertyBarRenderSource).toContain('settingKey="textSize"');
        expect(propertyBarRenderSource).toMatch(/currentValue=\{(?:options\.)?stickerToolSettings\.textSize\}/);
        expect(textControllerSource).toContain(
            "fontSize: sanitizeTextSize(existing?.fontSize ?? stickerToolSettings.textSize)",
        );
        expect(viewModelSource).toContain("fontSize: sanitizeTextSize(draft.fontSize)");
        expect(viewModelSource).toContain("text().fontSize");
        expect(exportSource).toContain("text.fontSize");
    });

    it("uses the shared color-slot palette for text color instead of the generic active color controls", () => {
        expect(typeSource).toContain("textColor: string");
        expect(stickerEditingDefaultsSource).toContain('textColor: "#ef4444"');
        expect(propertyBarRenderSource).toContain('title="文字颜色"');
        expect(propertyBarRenderSource).toContain('slot="textColor"');
        expect(propertyBarRenderSource).toContain("Icon={TextIcon}");
        expect(propertyBarSource).toContain("<ColorPicker");
        expect(propertyBarSource).not.toContain("renderColorControls");
        expect(textControllerSource).toContain("color: existing?.style.color ?? stickerToolSettings.textColor");
        expect(viewModelSource).toContain("color: draft.color");
        expect(viewModelSource).not.toContain("color: getEffectiveStickerColor(stickerColorState)");
    });

    it("creates text through an inline input near the clicked text position instead of a blocking prompt", () => {
        expect(annotationLayerSource).toContain("pendingTextInput");
        expect(annotationLayerSource).toContain("commitPendingTextInput");
        expect(textControllerSource).toContain("setPendingTextInput({");
        expect(annotationLayerSource).toContain('aria-label="输入标注文本"');
        expect(annotationLayerSource).toContain("pendingTextInputStyle()");
        expect(annotationLayerSource).toContain("onKeyDown={(event) => handlePendingTextInputKeyDown(event)}");
        expect(annotationLayerSource).not.toContain('window.prompt("输入标注文本"');
    });

    it("renders the text draft through the same SVG text renderer while the user types", () => {
        expect(annotationLayerSource).toContain("pendingTextPreviewAnnotation");
        expect(annotationLayerSource).toContain("<Show when={pendingTextPreviewAnnotation()}");
        expect(viewModelSource).toContain("visiblePreviewAnnotations");
        expect(textControllerSource).toContain('color: "transparent"');
        expect(textControllerSource).toContain('"caret-color": draft.color');
        expect(textControllerSource).toContain("draft.y - draft.fontSize");
        expect(textControllerSource).toContain("top: `${top}px`");
    });

    it("keeps the pending SVG preview bound to the live text accessor instead of the first typed snapshot", () => {
        expect(viewModelSource).toContain("const renderTextAnnotation = (text: Accessor<StickerTextAnnotation>)");
        expect(viewModelSource).toContain("text().text");
        expect(viewModelSource).toContain("text().fontSize");
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
        expect(stickerEditingDefaultsSource).toContain('textFontFamily: "微软雅黑"');
        expect(stickerEditingDefaultsSource).toContain('serialFontFamily: "微软雅黑"');
        expect(uiStoreSource).toContain("patchStickerToolSettings");
        expect(textControllerSource).toContain("fontFamily: resolveTextAnnotationFontFamily(existing)");
        expect(pointerDownSource).toContain("fontFamily: stickerToolSettings.serialFontFamily");
        expect(viewModelSource).toContain("fontFamily: draft.fontFamily");
        expect(viewModelSource).toContain("text().fontFamily");
        expect(exportSource).toContain("text.fontFamily");
        expect(mutationSource).toContain("updateTextAnnotationFontFamilyById");
    });

    it("drives a font dropdown from preset fonts plus installed system fonts", () => {
        expect(fontCatalogSource).toContain("COMMON_STICKER_FONT_FAMILIES");
        expect(fontCatalogSource).toContain("mergeStickerFontFamilies");
        expect(installedFontLoaderSource).toMatch(/api\s*\.\s*getInstalledFonts\(\)/);
        expect(installedFontLoaderSource).toContain("setInstalledStickerFonts(fonts)");
        expect(propertyBarSource).toContain("availableFontFamilies");
        expect(propertyBarRenderSource).toMatch(/value=\{(?:options\.)?stickerToolSettings\.textFontFamily\}/);
        expect(propertyBarRenderSource).toMatch(/value=\{(?:options\.)?stickerToolSettings\.serialFontFamily\}/);
        expect(propertyBarRenderSource).toContain('title="字体"');
        expect(propertyBarSelectionSource).toContain('updateTextAnnotationFontFamilyById');
        expect(bootSettingsApiSource).toContain("getInstalledFonts");
        expect(rustSource).toContain("get_installed_fonts");
    });

    it("shows the actual font for a selected text or serial node without overwriting the next default font", () => {
        expect(topStripSource).toContain("resolveSelectedExistingNodePropertyTool");
        expect(propertyBarSelectionSource).toContain("selectedExistingTextFontFamily");
        expect(propertyBarSelectionSource).toContain("selectedExistingSerialFontFamily");
        expect(propertyBarRenderSource).toContain('title="节点字体"');
        expect(propertyBarRenderSource).toContain('applySelectedAnnotationFontFamilyChange("text", value)');
        expect(propertyBarRenderSource).toContain('applySelectedAnnotationFontFamilyChange("serial", value)');
        expect(textControllerSource).toContain(
            'const resolveTextAnnotationFontFamily = (annotation?: StickerTextAnnotation) =>',
        );
    });

    it("gives selected text and serial nodes four-corner resize handles in Q mode", () => {
        expect(pointerDownSource).toContain("const beginDirectTransform = (");
        expect(selectionOverlaySource).toContain('const textAnnotation = value as StickerTextAnnotation;');
        expect(selectionOverlaySource).toContain("const bounds = getAnnotationBounds(textAnnotation);");
        expect(selectionOverlaySource).toContain('<Show when={props.transformMode === "select"}>');
        expect(selectionOverlaySource).toContain("<For each={getBoundsHandlePoints(bounds)}>");
        expect(selectionOverlaySource).toContain('props.beginDirectTransform(event, [value], "scale", { axis: "xy" })');
    });

    it("aligns text selection/export bounds to the SVG text baseline", () => {
        expect(textControllerSource).toContain("draft.y - draft.fontSize");
        expect(textGeometrySource).toContain("top: annotation.y - fontSize");
        expect(textGeometrySource).toContain("centerY: annotation.y - fontSize / 2");
        expect(exportSource).toContain('context.textBaseline = annotation.type === "serial" ? "middle" : "alphabetic";');
        expect(exportSource).not.toContain('context.textBaseline = annotation.type === "serial" ? "middle" : "top";');
    });
});
