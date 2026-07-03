import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const topStripPath = resolve(process.cwd(), "src/components/StickerTopStrip.tsx");
const propertyBarPath = resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx");
const topStripExists = existsSync(topStripPath);
const topStripSource = topStripExists ? readFileSync(topStripPath, "utf8") : "";
const propertyBarExists = existsSync(propertyBarPath);
const propertyBarSource = propertyBarExists ? readFileSync(propertyBarPath, "utf8") : "";
const layoutSource = topStripExists
    ? readFileSync(resolve(process.cwd(), "src/services/stickerTopStripLayout.ts"), "utf8")
    : "";
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const toolbarModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerToolbarModel.ts"), "utf8");
const legacyToolbarPath = resolve(process.cwd(), "src/components/StickerEditToolbar.tsx");
const legacyToolbarExists = existsSync(legacyToolbarPath);

describe("Hook sticker top strip contract", () => {
    it("uses the dedicated top strip as the only sticker editing chrome", () => {
        expect(topStripExists).toBe(true);
        expect(propertyBarExists).toBe(true);
        expect(topStripSource).toContain("export const StickerTopStrip");
        expect(topStripSource).toContain("computeStickerTopStripLayout");
        expect(layoutSource).toContain("STICKER_TOP_STRIP_SLOT_WIDTH = 50");
        expect(layoutSource).toContain("STICKER_TOP_STRIP_SLOT_COUNT = 10");
        expect(layoutSource).toContain("STICKER_TOP_STRIP_MIN_WIDTH = STICKER_TOP_STRIP_SLOT_WIDTH * STICKER_TOP_STRIP_SLOT_COUNT");
        expect(layoutSource).toContain("STICKER_TOP_STRIP_HEIGHT = 50");
        expect(layoutSource).toContain("STICKER_TOP_STRIP_PROPERTY_BAR_HEIGHT = 40");
        expect(legacyToolbarExists).toBe(false);
    });

    it("only mounts the top strip when sticker edit mode is active, matching the ctrl+e toolbar gate", () => {
        const topStripMountIndex = unitViewSource.indexOf("<StickerTopStrip");
        const topStripGuardIndex = unitViewSource.lastIndexOf("<Show when={", topStripMountIndex);
        const topStripMountBlock = unitViewSource.slice(topStripGuardIndex, topStripMountIndex + 240);

        expect(unitViewSource).toContain("<StickerTopStrip");
        expect(topStripMountBlock).toContain(
            'props.unit.type === "sticker" && props.isSelected && activeStickerEditTargetId() === props.unit.id',
        );
        expect(unitViewSource).toContain("activeStickerEditTargetId() === props.unit.id");
        expect(unitViewSource).not.toContain("<StickerEditToolbar");
    });

    it("registers the top strip as an interactive overlay rect so the new toolbar does not stay click-through outside the sticker body", () => {
        expect(topStripSource).toContain("addOrUpdateRect");
        expect(topStripSource).toContain("removeRect");
        expect(topStripSource).toContain("syncService.updateBackendRects");
        expect(topStripSource).toContain('root.querySelectorAll<HTMLElement>("button, input, select, [data-top-strip-menu=\'true\']")');
        expect(topStripSource).toContain('`sticker-top-strip-${props.unitId}`');
        expect(topStripSource).toContain('name: "STICKER_TOP_STRIP"');
        expect(topStripSource).toContain('pointer-events-none fixed z-[1210]');
        expect(topStripSource).toContain('class="pointer-events-auto flex items-stretch"');
        expect(topStripSource).toContain('onMouseDown={(event) => event.stopPropagation()}');
        expect(topStripSource).toContain("TRANSFORM_MODE_BUTTONS");
        expect(topStripSource).toContain("uiActions.setStickerTransformMode");
        expect(topStripSource).toContain('onClick={() => applyTransformMode(currentTransformMode())}');
        expect(topStripSource).toContain('setOpenMenu((current) => (current === "mode" ? null : "mode"))');
        expect(topStripSource).toContain('h-[50px] w-[50px]');
        expect(topStripSource).toContain('onPointerDown={(event) => event.stopPropagation()}');
        expect(topStripSource).toContain('absolute bottom-0 right-0 z-10 flex h-6 w-6');
        expect(topStripSource).toContain("window.addEventListener(\"pointerdown\"");
        expect(topStripSource).toContain("shape-rect");
        expect(topStripSource).toContain("shape-ellipse");
        expect(topStripSource).toContain("shape-triangle");
        expect(topStripSource).toContain("shape-polygon");
        expect(topStripSource).toContain("uiActions.setStickerEditMode");
        expect(topStripSource).toContain('onClick={() => applyCreateTool(currentShapeTool())}');
        expect(topStripSource).toContain('setOpenMenu((current) => (current === "shape" ? null : "shape"))');
        expect(topStripSource).toContain('onClick={() => applyCreateTool("line")}');
        expect(topStripSource).toContain('setOpenMenu((current) => (current === "line" ? null : "line"))');
        expect(topStripSource).toContain("矩形");
        expect(topStripSource).toContain("椭圆");
        expect(topStripSource).toContain("三角形");
        expect(topStripSource).toContain("多边形");
        expect(topStripSource).toContain("直线");
        expect(topStripSource).toContain('applyCreateTool("brush")');
        expect(topStripSource).toContain('setOpenMenu((current) => (current === "label" ? null : "label"))');
        expect(topStripSource).toContain('onClick={() => applyCreateTool(currentLabelTool())}');
        expect(topStripSource).toContain('setOpenMenu((current) => (current === "effect" ? null : "effect"))');
        expect(topStripSource).toContain('onClick={() => applyCreateTool(currentEffectTool())}');
        expect(topStripSource).toContain('onClick={() => applyTopStripTool("content-eraser")}');
        expect(topStripSource).toContain('onClick={() => applyTopStripTool("crop")}');
        expect(topStripSource).toContain('onClick={() => void runHistoryAction(currentHistoryAction())}');
        expect(topStripSource).toContain('setOpenMenu((current) => (current === "history" ? null : "history"))');
        expect(topStripSource).toContain("selectedStickerAnnotationIds");
        expect(topStripSource).toContain("rasterizeStickerAnnotationsForUnit");
        expect(topStripSource).toContain('onClick={() => void runRasterizeAction(currentRasterizeScope())}');
        expect(topStripSource).toContain('setOpenMenu((current) => (current === "rasterize" ? null : "rasterize"))');
        expect(topStripSource).toContain("画笔");
        expect(topStripSource).toContain("文本");
        expect(topStripSource).toContain("序号");
        expect(topStripSource).toContain("马赛克");
        expect(topStripSource).toContain("模糊");
        expect(topStripSource).toContain("橡皮擦");
        expect(topStripSource).toContain("裁剪");
        expect(topStripSource).toContain("撤销");
        expect(topStripSource).toContain("重做");
        expect(topStripSource).toContain("栅格化");
        expect(topStripSource).toContain("栅格化全部");
        expect(topStripSource).toContain("captureStickerEditSnapshot");
        expect(topStripSource).toContain("undoStickerHistory");
        expect(topStripSource).toContain("redoStickerHistory");
        expect(topStripSource).toContain("stickerEditHistories[props.unitId]");
        expect(topStripSource).toContain('currentHistoryAction() === item.mode');
        expect(topStripSource).toContain("resolveStickerTopStripPropertyTool");
        expect(topStripSource).toContain("resolveSelectedExistingNodePropertyTool");
        expect(topStripSource).toContain("selectedExistingAnnotationType");
        expect(topStripSource).toContain("selectedAnnotationIds().length");
        expect(topStripSource).toContain("StickerTopStripPropertyBar");
        expect(propertyBarSource).toContain("ColorPicker");
        expect(propertyBarSource).not.toContain("overflow-x-auto");
        expect(propertyBarSource).not.toContain('label="描边颜色"');
        expect(propertyBarSource).not.toContain('label="填充颜色"');
        expect(propertyBarSource).not.toContain('label="正图形"');
        expect(propertyBarSource).not.toContain('label="步进"');
        expect(propertyBarSource).not.toContain('label="线宽"');
        expect(propertyBarSource).not.toContain('label="线型"');
        expect(propertyBarSource).toContain('title="描边颜色"');
        expect(propertyBarSource).toContain('title="填充颜色"');
        expect(propertyBarSource).toContain('title="正图形开关"');
        expect(propertyBarSource).toContain('title="步进"');
        expect(propertyBarSource).toContain('title="线宽"');
        expect(propertyBarSource).toContain('title="线型"');
        expect(propertyBarSource).toContain('value={stickerToolSettings.shapeStrokeDashPattern}');
        expect(propertyBarSource).toContain('{ key: "solid", label: "━", title: "实线" }');
        expect(propertyBarSource).toContain('{ key: "dash-1", label: "╌", title: "虚线1" }');
        expect(propertyBarSource).toContain('{ key: "dash-2", label: "┄", title: "虚线2" }');
        expect(propertyBarSource).toContain(
            'shapeStrokeDashPattern: event.currentTarget.value as "solid" | "dash-1" | "dash-2"',
        );
        expect(propertyBarSource).not.toContain("class={dashButtonClass}");
        expect(propertyBarSource).toContain("SquareConstraintGlyphIcon");
        expect(propertyBarSource).toContain("Icon={SquareConstraintGlyphIcon}");
        expect(propertyBarSource).toContain("HighlighterGlowIcon");
        expect(propertyBarSource).toContain('Icon={HighlighterGlowIcon}');
        expect(propertyBarSource).toMatch(
            /title="线宽"[\s\S]*?settingKey="strokeWidth"[\s\S]*?currentValue=\{stickerToolSettings\.strokeWidth\}[\s\S]*?min=\{1\}[\s\S]*?max=\{96\}[\s\S]*?Icon=\{LineWidthIcon\}/,
        );
        expect(propertyBarSource).toContain('settingKey="shapeCornerRadius"');
        expect(propertyBarSource).toContain('title="圆角半径"');
        expect(propertyBarSource).toContain("PolygonSidesIcon");
        expect(propertyBarSource).toContain('onPointerDown={(event) => event.stopPropagation()}');
        expect(propertyBarSource).toContain('onMouseDown={(event) => event.stopPropagation()}');
        expect(propertyBarSource).toContain("<Portal>");
        expect(propertyBarSource).toContain("shapeConstrainSquare");
        expect(propertyBarSource).toContain("shapeSnapStep");
        expect(propertyBarSource).toContain("shapeStrokeDashPattern");
        expect(propertyBarSource).toContain('settingKey="contentEraserSize"');
        expect(propertyBarSource).toContain('title="擦除半径"');
        expect(propertyBarSource).toContain('title="只擦标记"');
        expect(propertyBarSource).toContain("contentEraserOnlyAnnotations");
        expect(propertyBarSource).toContain("AnnotationsOnlyFocusedIcon");
        expect(propertyBarSource).toContain('title="翻X"');
        expect(propertyBarSource).toContain('title="翻Y"');
        expect(propertyBarSource).toContain('title="重置裁剪"');
        expect(propertyBarSource).toContain('title="圆角半径"');
        expect(propertyBarSource).toContain('title="边框开关"');
        expect(propertyBarSource).toContain('title="透明度"');
        expect(propertyBarSource).toContain('title="大小"');
        expect(propertyBarSource).toContain("scaleStickerFrame");
        expect(propertyBarSource).toContain("toggleStickerBorder");
        expect(propertyBarSource).toContain("OpacityIcon");
        expect(propertyBarSource).toContain("CanvasSizeIcon");
        expect(propertyBarSource).toContain("commitCropOpacityDraft");
        expect(propertyBarSource).toContain("commitCropCanvasWidthDraft");
        expect(propertyBarSource).toContain("commitCropCornerRadiusDraft");
        expect(propertyBarSource).toContain('props.tool === "crop"');
        expect(propertyBarSource).toContain("flipStickerEditDataForFrame");
        expect(propertyBarSource).toContain("flipRasterizedAnnotationLayer");
        expect(propertyBarSource).toContain("computeRestoredCropFrame");
        expect(propertyBarSource).toMatch(
            /props\.tool === "crop"[\s\S]*?MiniDeferredNumericField[\s\S]*?title="圆角半径"[\s\S]*?Icon=\{RadiusIcon\}[\s\S]*?onCommit=\{commitCropCornerRadiusDraft\}/,
        );
        expect(propertyBarSource).toMatch(
            /props\.tool === "crop"[\s\S]*?MiniDeferredNumericField[\s\S]*?title="透明度"[\s\S]*?onCommit=\{commitCropOpacityDraft\}/,
        );
        expect(propertyBarSource).toMatch(
            /props\.tool === "crop"[\s\S]*?MiniDeferredNumericField[\s\S]*?title="大小"[\s\S]*?onCommit=\{commitCropCanvasWidthDraft\}/,
        );
        expect(propertyBarSource).toContain('props.tool === "selected-text"');
        expect(propertyBarSource).toContain('props.tool === "selected-serial"');
        expect(propertyBarSource).toContain("updateTextAnnotationFontFamilyById");
        expect(propertyBarSource).toContain("selectedExistingTextAnnotation");
        expect(propertyBarSource).toContain("selectedExistingTextFontFamily");
        expect(propertyBarSource).toContain("selectedExistingSerialFontFamily");
        expect(propertyBarSource).toContain("selectedExistingTextSize");
        expect(propertyBarSource).toContain("selectedExistingSerialRadius");
        expect(propertyBarSource).toContain("selectedExistingTextColor");
        expect(propertyBarSource).toContain("selectedExistingSerialForegroundColor");
        expect(propertyBarSource).toContain("selectedExistingSerialFillColor");
        expect(propertyBarSource).toContain("updateSelectedTextAnnotationStyle");
        expect(propertyBarSource).toContain("patchSelectedTextAnnotationFontSize");
        expect(propertyBarSource).toContain("patchSelectedSerialAnnotationRadius");
        expect(propertyBarSource).toContain('props.tool === "selected-text"');
        expect(propertyBarSource).toContain('title="节点文字颜色"');
        expect(propertyBarSource).toContain('title="节点字号"');
        expect(propertyBarSource).toContain('title="节点字体"');
        expect(propertyBarSource).toContain('props.tool === "selected-serial"');
        expect(propertyBarSource).toContain('title="节点描边/数字颜色"');
        expect(propertyBarSource).toContain('title="节点填充颜色"');
        expect(propertyBarSource).toContain('title="节点半径"');
        expect(toolbarModelSource).toContain("resolveStickerTopStripPropertyTool");
        expect(toolbarModelSource).toContain("resolveSelectedExistingNodePropertyTool");
        expect(toolbarModelSource).toContain('| "selected-text"');
        expect(toolbarModelSource).toContain('| "selected-serial"');
        expect(toolbarModelSource).toContain('| "crop"');
        expect(toolbarModelSource).toContain("shape-rect");
        expect(toolbarModelSource).toContain("line");
        expect(toolbarModelSource).toContain("brush");
        expect(toolbarModelSource).toContain("text");
        expect(toolbarModelSource).toContain("serial");
        expect(toolbarModelSource).toContain("mosaic");
        expect(toolbarModelSource).toContain("blur");
        expect(toolbarModelSource).toContain("content-eraser");
        expect(topStripSource).toContain('pointer-events-none fixed z-[1210]');
        expect(unitViewSource).toContain("unitId={props.unit.id}");
    });
});
