import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const propertyBarSectionsPath = resolve(process.cwd(), "src/components/stickerTopStripPropertyBarSections.tsx");
const propertyBarSectionsExists = existsSync(propertyBarSectionsPath);
const propertyBarSectionsSource = propertyBarSectionsExists ? readFileSync(propertyBarSectionsPath, "utf8") : "";
const propertyBarRenderSource = `${propertyBarSource}\n${propertyBarSectionsSource}`;
const propertyBarSectionSource = propertyBarSectionsExists ? propertyBarSectionsSource : propertyBarSource;
const fieldsSource = readFileSync(resolve(process.cwd(), "src/components/stickerTopStripPropertyBarFields.tsx"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/store/uiStore.ts"), "utf8");
const stickerEditingSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditing.ts"), "utf8");
const exportSource = readFileSync(resolve(process.cwd(), "src/services/stickerExport.ts"), "utf8");
const typeSource = readFileSync(resolve(process.cwd(), "src/types/stickerEditing.ts"), "utf8");

const sourceBetween = (source: string, start: string, end: string) => {
    const startIndex = source.indexOf(start);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    const endIndex = source.indexOf(end, startIndex + start.length);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
};

describe("Hook sticker style controls contract", () => {
    it("exposes per-shape independent stroke/fill color slots backed by one shared palette", () => {
        expect(propertyBarRenderSource).toContain("MiniColorField");
        expect(propertyBarRenderSource).toContain("MiniNumericField");
        expect(propertyBarRenderSource).toContain("MiniDashField");
        expect(propertyBarRenderSource).toContain('title="圆角半径"');
        expect(propertyBarRenderSource).toContain("shapeCornerRadius");
        expect(propertyBarSource).toContain("addStickerPaletteColor");
        expect(propertyBarSource).toContain("removeStickerPaletteColor");
        expect(propertyBarRenderSource).toContain('title="线宽"');

        // Each shape/line tool keeps an independent color rather than sharing one shape color.
        expect(propertyBarSource).toContain("shapeStrokeColorSlot");
        expect(propertyBarSource).toContain("shapeFillColorSlot");
        expect(propertyBarSource).not.toContain("shapeStrokeColor:");
        expect(propertyBarSource).not.toContain("shapeFillColor:");

        expect(typeSource).toContain("rectStrokeColor");
        expect(typeSource).toContain("rectFillColor");
        expect(typeSource).toContain("ellipseStrokeColor");
        expect(typeSource).toContain("triangleStrokeColor");
        expect(typeSource).toContain("polygonStrokeColor");
        expect(typeSource).toContain("lineStrokeColor");

        expect(stickerEditingSource).toContain("rectStrokeColor");
        expect(stickerEditingSource).toContain("rectFillColor");
        expect(stickerEditingSource).toContain("lineStrokeColor");
        expect(stickerEditingSource).toContain("shapeCornerRadius");
        expect(uiStoreSource).toContain("addStickerPaletteColor");
        expect(uiStoreSource).toContain("removeStickerPaletteColor");
        expect(uiStoreSource).toContain("patchStickerToolSettings");

        expect(annotationLayerSource).toContain("getShapeStrokeColorForMode");
        expect(annotationLayerSource).toContain("getShapeFillColorForMode");
        expect(annotationLayerSource).toContain("shapeCornerRadius");
        expect(annotationLayerSource).toContain("buildRoundedPolygonPath");
        expect(annotationModelSource).toContain("isTransparentStickerColor");
        expect(annotationLayerSource).not.toContain("shapeFilled");
        expect(exportSource).toContain("traceRoundedPolygonPath");
    });

    it("uses a single unified modal color picker for every tool, with the legacy popover subsystem fully removed", () => {
        // The whole toolbar drives color editing through one component + one helper.
        expect(propertyBarSource).toContain("openColorPicker");
        expect(propertyBarSource).toContain("openSelectedExistingColorPicker");
        expect(propertyBarSource).toContain("<ColorPicker");

        // The legacy Godot-style inline popover subsystem is gone (no split UI).
        expect(propertyBarSource).not.toContain("renderColorPickerPopover");
        expect(propertyBarSource).not.toContain("renderColorSlotButton");
        expect(propertyBarSource).not.toContain("renderShapeColorSlot");
        expect(propertyBarSource).not.toContain("renderColorControls");
        expect(propertyBarSource).not.toContain("activeColorPopoverSlot");
        expect(propertyBarSource).not.toContain("beginShapeSlotScreenPicker");
    });

    it("routes the modal picker through apply/add/remove/screen-pick callbacks", () => {
        const pickerStart = propertyBarSource.indexOf("<ColorPicker");
        expect(pickerStart).toBeGreaterThan(-1);
        const pickerEnd = propertyBarSource.indexOf("/>", pickerStart);
        expect(pickerEnd).toBeGreaterThan(pickerStart);
        const pickerSource = propertyBarSource.slice(pickerStart, pickerEnd);

        expect(pickerSource).toContain("onChange={(color) =>");
        expect(pickerSource).toContain("onAddToPalette");
        expect(pickerSource).toContain("onRemoveFromPalette");
        expect(pickerSource).toContain("onPickFromScreen");
        expect(pickerSource).toContain("palette={stickerColorState.palette}");
    });

    it("uses the unified modal color picker for the line tool with its own independent color and exposes arrow as a line option", () => {
        expect(propertyBarRenderSource).toContain("const renderLineFields = () => (");
        expect(propertyBarSource).toContain("<Show when={isLineTool()}>{renderLineFields()}</Show>");
        const lineSource = sourceBetween(
            propertyBarSectionSource,
            "const renderLineFields = () => (",
            "const renderBrushFields = () => (",
        );

        expect(lineSource).toContain('title="描边颜色"');
        expect(lineSource).toContain("shapeStrokeColorSlot()");
        expect(lineSource).toContain("Icon={StrokeColorIcon}");
        expect(lineSource).toContain('title="线型"');
        expect(lineSource).toContain("lineArrowEnabled");
        expect(lineSource).toContain('title="角吸附"');
        expect(lineSource).not.toContain("renderColorControls(false)");
    });

    it("uses the unified modal color picker for paint tools and makes highlighter a brush option", () => {
        expect(propertyBarRenderSource).toContain("const renderBrushFields = () => (");
        expect(propertyBarSource).toContain("<Show when={isBrushTool()}>{renderBrushFields()}</Show>");
        expect(propertyBarRenderSource).toContain("const renderEffectFields = () => (");
        const brushSource = sourceBetween(
            propertyBarSectionSource,
            "const renderBrushFields = () => (",
            "const renderTextFields = () => (",
        );
        expect(brushSource).toContain('title="画笔颜色"');
        expect(brushSource).toContain('slot="brushColor"');
        expect(brushSource).toContain("Icon={StrokeColorIcon}");
        expect(brushSource).toContain('title="荧光开关"');
        expect(brushSource).toContain("brushHighlighterEnabled");
        expect(brushSource).not.toContain("renderColorControls(false)");

        const mosaicSource = sourceBetween(
            propertyBarSectionSource,
            "const renderEffectFields = () => (",
            "const renderEraserFields = () => (",
        );
        // Mosaic is now image pixelation (each block samples the underlying image),
        // so there are no fixed color-block pickers — just a brush size + the unit
        // square width control. No rectangle border controls.
        expect(mosaicSource).not.toContain('"色块A"');
        expect(mosaicSource).not.toContain('"色块B"');
        expect(mosaicSource).toContain('settingKey="effectBrushSize"');
        expect(mosaicSource).toContain('settingKey="mosaicSize"');
        expect(mosaicSource).not.toContain("renderColorControls(false)");
    });

    it("gives blur a brush-size control without rectangle border or generic active color controls", () => {
        expect(propertyBarSource).toContain("<Show when={isEffectTool()}>{renderEffectFields()}</Show>");
        const blurSource = sourceBetween(
            propertyBarSectionSource,
            "const renderEffectFields = () => (",
            "const renderEraserFields = () => (",
        );

        expect(blurSource).toContain('settingKey="effectBrushSize"');
        expect(blurSource).toContain('settingKey="blurStrength"');
        expect(blurSource).not.toContain("renderColorControls(false)");
    });

    it("gives serial annotations palette-backed foreground, background, and radius controls with adaptive border and digit sizing", () => {
        expect(typeSource).toContain("serialForegroundColor: string");
        expect(typeSource).toContain("serialFillColor: string");
        expect(typeSource).toContain("serialRadius: number");
        expect(stickerEditingSource).toContain("serialForegroundColor: \"#ef4444\"");
        expect(stickerEditingSource).toContain("serialFillColor: \"#000000\"");
        expect(stickerEditingSource).toContain("serialRadius: 14");
        expect(stickerEditingSource).toContain("buildSerialAnnotationMetrics");

        expect(propertyBarRenderSource).toContain("const renderSerialFields = () => (");
        expect(propertyBarSource).toContain("<Show when={isSerialTool()}>{renderSerialFields()}</Show>");
        const serialSource = sourceBetween(
            propertyBarSectionSource,
            "const renderSerialFields = () => (",
            "const renderSelectedSerialFields = () => (",
        );

        expect(serialSource).toContain('title="描边颜色"');
        expect(serialSource).toContain('slot="serialForegroundColor"');
        expect(serialSource).toContain('title="填充颜色"');
        expect(serialSource).toContain('slot="serialFillColor"');
        expect(serialSource).toContain('settingKey="serialRadius"');
        expect(serialSource).not.toContain("renderTextControls()");

        expect(annotationLayerSource).toContain("buildSerialAnnotationMetrics(stickerToolSettings.serialRadius)");
        expect(annotationLayerSource).toContain("color: stickerToolSettings.serialForegroundColor");
        expect(annotationLayerSource).toContain("fill: stickerToolSettings.serialFillColor");
        expect(annotationLayerSource).toContain("cornerRadius: serialMetrics.radius");
        expect(annotationLayerSource).toContain("const serialMetrics = createMemo(() => buildSerialAnnotationMetrics(text().style.cornerRadius ?? 14))");
        expect(annotationLayerSource).toContain('dominant-baseline={text().type === "serial" ? "central" : undefined}');
        expect(annotationLayerSource).toContain("y={text().type === \"serial\" ? text().y - serialFontSize() / 2 : text().y}");
        expect(exportSource).toContain("const serialMetrics = buildSerialAnnotationMetrics(text.style.cornerRadius ?? 14)");
        expect(exportSource).toContain('context.textBaseline = annotation.type === "serial" ? "middle" : "alphabetic";');
        expect(exportSource).toContain("isTransparentStickerColor(text.style.fill)");
    });

    it("keeps numeric property inputs as drafts until Enter or blur instead of committing every keystroke", () => {
        expect(propertyBarSource).toContain("const [numericDrafts, setNumericDrafts]");
        expect(propertyBarSource).toContain("const commitNumericDraft = (");
        expect(propertyBarRenderSource).toContain("MiniNumericField");
        expect(propertyBarRenderSource).toContain("MiniDeferredNumericField");
        expect(fieldsSource).toContain('if (event.key !== "Enter") return;');

        expect(propertyBarRenderSource).toContain('settingKey="serialRadius"');
        expect(propertyBarRenderSource).toContain('settingKey="contentEraserSize"');
        expect(propertyBarRenderSource).toContain('settingKey="mosaicSize"');
        expect(propertyBarRenderSource).toContain('settingKey="blurStrength"');
        expect(propertyBarSource).toContain('const [cropCornerRadiusDraft, setCropCornerRadiusDraft] = createSignal<string | null>(null);');
        expect(propertyBarRenderSource).toMatch(
            /value=\{(?:options\.)?cropCornerRadiusDraft\(\) \?\? String\((?:options\.)?getEditableFrameCornerRadius\(\)\)\}/,
        );
        expect(propertyBarRenderSource).toMatch(/onCommit=\{(?:options\.)?commitCropCornerRadiusDraft\}/);
    });

    it("renders sticker appearance steppers through a stable component so typing does not remount the input and trigger blur commits", () => {
        expect(propertyBarSource).toContain("createStickerTopStripPropertyBarFields({");
        expect(fieldsSource).toContain("export type MiniDeferredNumericFieldComponent = Component<");
        expect(fieldsSource).toContain("export type MiniNumericFieldComponent = Component<");
        expect(fieldsSource).toContain("const MiniDeferredNumericField: MiniDeferredNumericFieldComponent =");
        expect(fieldsSource).toContain("const MiniNumericField: MiniNumericFieldComponent =");
        expect(propertyBarSource).not.toContain("renderCanvasStepperControl");
    });
});
