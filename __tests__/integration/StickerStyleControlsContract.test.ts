import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");
const uiStoreSource = readFileSync(resolve(process.cwd(), "src/store/uiStore.ts"), "utf8");
const stickerEditingSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditing.ts"), "utf8");
const exportSource = readFileSync(resolve(process.cwd(), "src/services/stickerExport.ts"), "utf8");
const typeSource = readFileSync(resolve(process.cwd(), "src/types/stickerEditing.ts"), "utf8");

describe("Hook sticker style controls contract", () => {
    it("exposes per-shape independent stroke/fill color slots backed by one shared palette", () => {
        expect(propertyBarSource).toContain("MiniColorField");
        expect(propertyBarSource).toContain("MiniNumericField");
        expect(propertyBarSource).toContain("MiniDashField");
        expect(propertyBarSource).toContain('title="圆角半径"');
        expect(propertyBarSource).toContain("shapeCornerRadius");
        expect(propertyBarSource).toContain("addStickerPaletteColor");
        expect(propertyBarSource).toContain("removeStickerPaletteColor");
        expect(propertyBarSource).toContain('title="线宽"');

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
        const lineStart = propertyBarSource.indexOf("<Show when={isLineTool()}>");
        const lineEnd = propertyBarSource.indexOf("<Show when={isBrushTool()}>");
        expect(lineStart).toBeGreaterThan(-1);
        expect(lineEnd).toBeGreaterThan(lineStart);
        const lineSource = propertyBarSource.slice(lineStart, lineEnd);

        expect(lineSource).toContain('<MiniColorField title="描边颜色" slot={shapeStrokeColorSlot()} Icon={StrokeColorIcon} />');
        expect(lineSource).toContain('<MiniDashField title="线型" />');
        expect(lineSource).toContain("lineArrowEnabled");
        expect(lineSource).toContain('title="角吸附"');
        expect(lineSource).not.toContain("renderColorControls(false)");
    });

    it("uses the unified modal color picker for paint tools and makes highlighter a brush option", () => {
        const brushStart = propertyBarSource.indexOf("<Show when={isBrushTool()}>");
        const mosaicStart = propertyBarSource.indexOf("<Show when={isTextTool()}>");
        const blurStart = propertyBarSource.indexOf("<Show when={isEffectTool()}>");
        expect(brushStart).toBeGreaterThan(-1);
        expect(mosaicStart).toBeGreaterThan(brushStart);
        expect(blurStart).toBeGreaterThan(mosaicStart);

        const brushSource = propertyBarSource.slice(brushStart, mosaicStart);
        expect(brushSource).toContain('<MiniColorField title="画笔颜色" slot="brushColor" Icon={StrokeColorIcon} />');
        expect(brushSource).toContain('title="荧光开关"');
        expect(brushSource).toContain("brushHighlighterEnabled");
        expect(brushSource).not.toContain("renderColorControls(false)");

        const mosaicSource = propertyBarSource.slice(blurStart);
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
        const blurStart = propertyBarSource.indexOf("<Show when={isEffectTool()}>");
        const serialStart = propertyBarSource.indexOf("<Show when={isEraserTool()}>");
        expect(blurStart).toBeGreaterThan(-1);
        expect(serialStart).toBeGreaterThan(blurStart);
        const blurSource = propertyBarSource.slice(blurStart, serialStart);

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

        const serialStart = propertyBarSource.indexOf("<Show when={isSerialTool()}>");
        const finalizeStart = propertyBarSource.indexOf("<Show when={props.tool === \"selected-serial\"}>");
        expect(serialStart).toBeGreaterThan(-1);
        expect(finalizeStart).toBeGreaterThan(serialStart);
        const serialSource = propertyBarSource.slice(serialStart, finalizeStart);

        expect(serialSource).toContain('<MiniColorField title="描边颜色" slot="serialForegroundColor" Icon={StrokeColorIcon} />');
        expect(serialSource).toContain('<MiniColorField title="填充颜色" slot="serialFillColor" Icon={FillColorIcon} />');
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
        expect(exportSource).toContain('context.textBaseline = annotation.type === "serial" ? "middle" : "top";');
        expect(exportSource).toContain("isTransparentStickerColor(text.style.fill)");
    });

    it("keeps numeric property inputs as drafts until Enter or blur instead of committing every keystroke", () => {
        expect(propertyBarSource).toContain("const [numericDrafts, setNumericDrafts]");
        expect(propertyBarSource).toContain("const commitNumericDraft = (");
        expect(propertyBarSource).toContain("MiniNumericField");
        expect(propertyBarSource).toContain("MiniDeferredNumericField");
        expect(propertyBarSource).toContain('if (event.key !== "Enter") return;');

        expect(propertyBarSource).toContain('settingKey="serialRadius"');
        expect(propertyBarSource).toContain('settingKey="contentEraserSize"');
        expect(propertyBarSource).toContain('settingKey="mosaicSize"');
        expect(propertyBarSource).toContain('settingKey="blurStrength"');
        expect(propertyBarSource).toContain('const [cropCornerRadiusDraft, setCropCornerRadiusDraft] = createSignal<string | null>(null);');
        expect(propertyBarSource).toContain('value={cropCornerRadiusDraft() ?? String(getEditableFrameCornerRadius())}');
        expect(propertyBarSource).toContain('onCommit={commitCropCornerRadiusDraft}');
    });

    it("renders sticker appearance steppers through a stable component so typing does not remount the input and trigger blur commits", () => {
        expect(propertyBarSource).toContain("const MiniDeferredNumericField: Component<");
        expect(propertyBarSource).toContain("const MiniNumericField: Component<");
        expect(propertyBarSource).not.toContain("renderCanvasStepperControl");
    });
});
