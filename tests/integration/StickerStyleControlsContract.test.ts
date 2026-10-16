import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarSource = readFileSync(resolve(process.cwd(), "src/features/stickers/components/StickerTopStripPropertyBar.tsx"), "utf8");
const propertyBarSectionsPath = resolve(process.cwd(), "src/features/stickers/components/stickerTopStripPropertyBarSections.tsx");
const propertyBarSectionsExists = existsSync(propertyBarSectionsPath);
const propertyBarSectionsSource = propertyBarSectionsExists ? readFileSync(propertyBarSectionsPath, "utf8") : "";
const propertyBarRenderSource = `${propertyBarSource}\n${propertyBarSectionsSource}`;
const propertyBarSectionSource = propertyBarSectionsExists ? propertyBarSectionsSource : propertyBarSource;
const fieldsSource = readFileSync(resolve(process.cwd(), "src/features/stickers/components/stickerTopStripPropertyBarFields.tsx"), "utf8");
const propertyBarCropSource = readFileSync(
    resolve(process.cwd(), "src/features/stickers/components/stickerTopStripPropertyBarCropController.ts"),
    "utf8",
);
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/features/stickers/components/StickerAnnotationLayer.tsx"), "utf8");
const annotationStyleSource = readFileSync(resolve(process.cwd(), "src/features/stickers/components/stickerAnnotationStyle.ts"), "utf8");
const annotationPointerCommitSource = readFileSync(
    resolve(process.cwd(), "src/features/stickers/components/stickerAnnotationPointerCommitController.ts"),
    "utf8",
);
const annotationPointerDownSource = readFileSync(
    resolve(process.cwd(), "src/features/stickers/components/stickerAnnotationPointerDownController.ts"),
    "utf8",
);
const annotationViewModelSource = readFileSync(
    resolve(process.cwd(), "src/features/stickers/components/stickerAnnotationViewModel.tsx"),
    "utf8",
);
const annotationDraftSource = readFileSync(
    resolve(process.cwd(), "src/features/stickers/components/StickerAnnotationDraftOverlays.tsx"),
    "utf8",
);
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/features/stickers/components/stickerAnnotationModel.ts"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/features/workspace/state/uiStore.ts"), "utf8");
const stickerEditingFacadeSource = readFileSync(resolve(process.cwd(), "src/features/stickers/services/stickerEditing.ts"), "utf8");
const stickerEditingDefaultsSource = readFileSync(resolve(process.cwd(), "src/features/stickers/services/stickerEditingDefaults.ts"), "utf8");
const stickerStyleValuesSource = readFileSync(resolve(process.cwd(), "src/features/stickers/services/stickerStyleValues.ts"), "utf8");
const exportSource = readFileSync(resolve(process.cwd(), "src/features/stickers/services/stickerAnnotationDrawing.ts"), "utf8");
const typeSource = readFileSync(resolve(process.cwd(), "src/features/stickers/types/stickerEditing.ts"), "utf8");
const readComponent = (name: string) => readFileSync(resolve(process.cwd(), "src/features/stickers/components", name), "utf8");
const lineFieldsSource = readComponent("LinePropertyFields.tsx");
const brushFieldsSource = readComponent("BrushPropertyFields.tsx");
const effectFieldsSource = readComponent("EffectPropertyFields.tsx");
const textSerialFieldsSource = readComponent("TextSerialPropertyFields.tsx");
const drawingFieldsSource = readComponent("RectanglePropertyFields.tsx");

const sourceBetween = (source: string, start: string, end: string) => {
    const startIndex = source.indexOf(start);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    const endIndex = source.indexOf(end, startIndex + start.length);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
};

describe("Otter sticker style controls contract", () => {
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

        expect(stickerEditingDefaultsSource).toContain("rectStrokeColor");
        expect(stickerEditingDefaultsSource).toContain("rectFillColor");
        expect(stickerEditingDefaultsSource).toContain("lineStrokeColor");
        expect(stickerEditingDefaultsSource).toContain("shapeCornerRadius");
        expect(uiStoreSource).toContain("addStickerPaletteColor");
        expect(uiStoreSource).toContain("removeStickerPaletteColor");
        expect(uiStoreSource).toContain("patchStickerToolSettings");

        expect(annotationStyleSource).toContain("getShapeStrokeColorForMode");
        expect(annotationStyleSource).toContain("getShapeFillColorForMode");
        expect(annotationStyleSource).toContain("shapeCornerRadius");
        expect(annotationPointerCommitSource).toContain("getShapeStrokeColorForMode");
        expect(annotationDraftSource).toContain("buildRoundedPolygonPath");
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
        expect(propertyBarSource).toContain("<LinePropertyFields");
        expect(propertyBarSource).toContain("openColorPicker={openColorPicker}");
        const lineSource = lineFieldsSource;

        expect(lineSource).toContain('title="描边颜色"');
        expect(lineSource).toContain('slot="lineStrokeColor"');
        expect(lineSource).toContain("openColorPicker={props.openColorPicker}");
        expect(lineSource).toContain('title="线型"');
        expect(lineSource).toContain("lineArrowEnabled");
        expect(lineSource).toContain('title="角度吸附"');
        expect(lineSource).toContain("<Show when={!props.bezier && !props.selected}>");
        expect(lineSource).not.toContain("renderColorControls(false)");
    });

    it("uses the unified modal color picker for paint tools and makes highlighter a brush option", () => {
        expect(propertyBarSource).toContain("<BrushPropertyFields");
        expect(propertyBarSectionsSource).toContain('<EffectPropertyFields blur={options.tool() === "blur"} />');
        const brushSource = brushFieldsSource;
        expect(brushSource).toContain('title="笔触颜色"');
        expect(brushSource).toContain('slot="brushColor"');
        expect(brushSource).toContain("openColorPicker={props.openColorPicker}");
        expect(brushSource).toContain("<Show when={!props.paintbrush}>");
        expect(brushSource).toContain('title="荧光开关"');
        expect(brushSource).toContain("brushHighlighterEnabled");
        expect(brushSource).not.toContain("renderColorControls(false)");

        const mosaicSource = effectFieldsSource;
        // Effect controls expose brush size and strength, not rectangle colors.
        expect(mosaicSource).not.toContain('"色块A"');
        expect(mosaicSource).not.toContain('"色块B"');
        expect(mosaicSource).toContain('setting="effectBrushSize"');
        expect(mosaicSource).toContain('setting="mosaicSize"');
        expect(mosaicSource).not.toContain("renderColorControls(false)");
    });

    it("gives blur a brush-size control without rectangle border or generic active color controls", () => {
        expect(propertyBarSource).toContain("<Show when={isEffectTool()}>{renderEffectFields()}</Show>");
        const blurSource = effectFieldsSource;

        expect(blurSource).toContain('setting="effectBrushSize"');
        expect(blurSource).toContain('setting="blurStrength"');
        expect(blurSource).not.toContain("renderColorControls(false)");
    });

    it("gives serial annotations palette-backed foreground, background, and radius controls with adaptive border and digit sizing", () => {
        expect(typeSource).toContain("serialForegroundColor: string");
        expect(typeSource).toContain("serialFillColor: string");
        expect(typeSource).toContain("serialRadius: number");
        expect(stickerEditingDefaultsSource).toContain("serialForegroundColor: \"#ef4444\"");
        expect(stickerEditingDefaultsSource).toContain("serialFillColor: \"#000000\"");
        expect(stickerEditingDefaultsSource).toContain("serialRadius: 14");
        expect(stickerEditingFacadeSource).toContain("buildSerialAnnotationMetrics");
        expect(stickerStyleValuesSource).toContain("export const buildSerialAnnotationMetrics");

        expect(propertyBarRenderSource).toContain("const renderSerialFields = () => (");
        expect(propertyBarSource).toContain("<Show when={isSerialTool()}>{renderSerialFields()}</Show>");
        const serialSource = sourceBetween(
            propertyBarSectionSource,
            "const renderSerialFields = () => (",
            "const renderSelectedSerialFields = () => (",
        );

        expect(serialSource).toContain('<TextSerialPropertyFields serial');
        expect(serialSource).toContain('options.openColorPicker("serialForegroundColor", button)');
        expect(serialSource).toContain('options.openColorPicker("serialFillColor", button)');
        expect(serialSource).toContain('size={options.stickerToolSettings.serialRadius}');
        expect(serialSource).toContain('options.patchStickerToolSettings({ serialRadius })');
        expect(textSerialFieldsSource).toContain('title={props.serial ? "描边/数字颜色" : "文字颜色"}');
        expect(textSerialFieldsSource).toContain('title="填充颜色"');
        expect(textSerialFieldsSource).toContain('value={props.size}');
        expect(serialSource).not.toContain("renderTextControls()");

        expect(annotationPointerDownSource).toContain("buildSerialAnnotationMetrics(");
        expect(annotationPointerDownSource).toContain(
            "sanitizeSerialRadius(stickerToolSettings.serialRadius)",
        );
        expect(annotationPointerDownSource).toContain("color: stickerToolSettings.serialForegroundColor");
        expect(annotationPointerDownSource).toContain("fill: stickerToolSettings.serialFillColor");
        expect(annotationPointerDownSource).toContain("cornerRadius: serialMetrics.radius");
        expect(annotationViewModelSource).toContain("buildSerialAnnotationMetrics(");
        expect(annotationViewModelSource).toContain(
            "sanitizeSerialRadius(text().style.cornerRadius ?? 14)",
        );
        expect(annotationViewModelSource).toContain('dominant-baseline={text().type === "serial" ? "central" : undefined}');
        expect(annotationViewModelSource).toContain("y={text().type === \"serial\" ? text().y - serialFontSize() / 2 : text().y}");
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

        expect(propertyBarRenderSource).toContain('size={options.stickerToolSettings.serialRadius}');
        expect(propertyBarRenderSource).toContain('setting="contentEraserSize"');
        expect(effectFieldsSource).toContain('setting="mosaicSize"');
        expect(effectFieldsSource).toContain('setting="blurStrength"');
        const inputHandler = sourceBetween(drawingFieldsSource, "onInput={(event) => {", "onKeyDown={(event) => {");
        expect(inputHandler).toContain("setDraft(next)");
        expect(inputHandler).not.toContain("patchStickerToolSettings");
        expect(inputHandler).not.toContain("update(");
        expect(inputHandler).toContain("onBlur={commit}");
        expect(drawingFieldsSource).toContain('if (event.key === "Enter") { commit();');
        expect(propertyBarCropSource).toContain(
            'const [cropCornerRadiusDraft, setCropCornerRadiusDraft] = createSignal<string | null>(null);',
        );
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
