import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const pointerRuntimeSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationPointerRuntime.ts"), "utf8");
const pointerCommitSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationPointerCommitController.ts"), "utf8");
const draftOverlaySource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationDraftOverlays.tsx"), "utf8");
const annotationStyleSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationStyle.ts"), "utf8");
const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const topStripEditActionsSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerTopStripEditActions.tsx"),
    "utf8",
);
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const propertyBarCropSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerTopStripPropertyBarCropController.ts"),
    "utf8",
);
const propertyBarSectionsPath = resolve(process.cwd(), "src/components/stickerTopStripPropertyBarSections.tsx");
const propertyBarSectionsExists = existsSync(propertyBarSectionsPath);
const propertyBarSectionsSource = propertyBarSectionsExists ? readFileSync(propertyBarSectionsPath, "utf8") : "";
const propertyBarRenderSource = `${propertyBarSource}\n${propertyBarSectionsSource}`;
const toolbarModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerToolbarModel.ts"), "utf8");

const sourceBetween = (source: string, start: string, end: string) => {
    const startIndex = source.indexOf(start);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    const endIndex = source.indexOf(end, startIndex + start.length);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
};

describe("Hook sticker crop interaction contract", () => {
    const cropCommitStart = pointerCommitSource.indexOf('if (shape.mode === "crop")');
    const cropCommitEnd = pointerCommitSource.indexOf('if (line.mode === "mosaic" || line.mode === "blur")');
    const cropCommitSource = pointerCommitSource.slice(cropCommitStart, cropCommitEnd);

    it("keeps the floating toolbar visible while crop mode is active so crop controls do not disappear", () => {
        expect(unitViewSource).toContain("<StickerTopStrip");
        expect(unitViewSource).not.toContain("<StickerEditToolbar");
        expect(unitViewSource).toContain("props.isSelected && activeStickerEditTargetId() === props.unit.id");
        expect(unitViewSource).toContain('supportsBitmapTools={props.unit.type === "sticker"}');
        expect(pointerCommitSource).toContain('if (shape.mode === "crop")');
        expect(cropCommitSource).not.toContain('uiActions.setStickerEditMode("select");');
        expect(cropCommitSource).not.toContain("setStickerEditMode");
        expect(unitViewSource).toContain('const hasSelectedExistingAnnotations = () =>');
        expect(unitViewSource).toContain('const shouldBlockContainerMouseDown = () => {');
        expect(unitViewSource).toContain('stickerToolSettings.domain !== "existing"');
        expect(unitViewSource).toContain('stickerToolSettings.transformMode !== "select"');
        expect(unitViewSource).toContain('const allowContainerMouseDown = () => !shouldBlockContainerMouseDown();');
        expect(unitViewSource).toContain('if (allowContainerMouseDown()) {');
        expect(pointerRuntimeSource).toContain("const captureHostPointer = (pointerId: number) => {");
        expect(pointerRuntimeSource).toContain("if (!target) return false;");
        expect(pointerRuntimeSource).toContain("target.setPointerCapture(pointerId);");
        expect(pointerRuntimeSource).toContain("const releaseHostPointer = () => {");
        expect(pointerRuntimeSource).toContain("hostRef.releasePointerCapture(pointerId);");
        expect(annotationLayerSource).not.toContain("onPointerLeave={() => void onPointerUp()}");
        expect(annotationLayerSource).toContain("const cropClipped = createMemo(");
        expect(annotationLayerSource).toContain('cropClipped() ? "hidden" : "visible"');
    });

    it("still routes the crop secondary tool to crop controls instead of hiding the whole toolbar", () => {
        const toolbarContractSource = `${topStripSource}\n${topStripEditActionsSource}\n${propertyBarRenderSource}\n${toolbarModelSource}`;

        expect(toolbarContractSource).toContain('{ id: "geometry", label: "几何"');
        expect(topStripSource).toContain('stickerToolSettings.domain === "sticker" && stickerToolSettings.activeCanvasTool === "crop"');
        expect(topStripSource).toContain("onCanvasTool={applyTopStripTool}");
        expect(topStripEditActionsSource).toContain('onClick={() => props.onCanvasTool("crop")}');
        expect(toolbarModelSource).toContain('if (activeCanvasTool === "crop") return "crop";');
        expect(propertyBarSource).toContain('props.tool === "crop"');
        expect(propertyBarSource).not.toContain("清理改动");
        expect(propertyBarRenderSource).toContain('title="重置裁剪"');
    });

    it("renders the crop drag preview as a square-cornered 4px solid outline with no fill", () => {
        const draftPreviewSource = sourceBetween(
            draftOverlaySource,
            "<Show when={props.draftShapeRect} keyed>",
            "<Show when={props.draftShapeMeasurement} keyed>",
        );

        expect(annotationStyleSource).toContain("export const getDraftShapePreviewFill =");
        expect(annotationStyleSource).toContain('mode === "crop" ? "none"');
        expect(annotationStyleSource).toContain("export const getDraftShapePreviewDashArray =");
        expect(annotationStyleSource).toContain('mode === "crop" ? undefined');
        expect(annotationStyleSource).toContain("export const getDraftShapePreviewCornerRadius =");
        expect(annotationStyleSource).toContain('mode === "crop" ? 0 : getShapeCornerRadius(mode)');
        expect(annotationStyleSource).toContain("export const getDraftShapePreviewStrokeWidth =");
        expect(annotationStyleSource).toContain(
            'mode === "crop" ? 4 : sanitizeStrokeWidth(stickerToolSettings.strokeWidth)',
        );
        expect(draftPreviewSource).toContain("fill={getDraftShapePreviewFill(props.draftShapeMode)}");
        expect(draftPreviewSource).toContain("rx={getDraftShapePreviewCornerRadius(props.draftShapeMode)}");
        expect(draftPreviewSource).toContain("ry={getDraftShapePreviewCornerRadius(props.draftShapeMode)}");
        expect(draftPreviewSource).toContain("stroke-width={getDraftShapePreviewStrokeWidth(props.draftShapeMode)}");
        expect(draftPreviewSource).toContain("stroke-dasharray={getDraftShapePreviewDashArray(props.draftShapeMode)}");
        expect(draftPreviewSource).not.toContain('stroke-dasharray="4 2"');
    });

    it("mirrors editable annotations together with crop flip actions instead of flipping only the bitmap", () => {
        const transformSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditTransforms.ts"), "utf8");
        const bitmapLayersSource = readFileSync(resolve(process.cwd(), "src/services/stickerBitmapLayers.ts"), "utf8");
        const imageModelSource = readFileSync(resolve(process.cwd(), "src/components/unitImageModel.ts"), "utf8");
        const imageContentSource = readFileSync(resolve(process.cwd(), "src/components/UnitStickerImageContent.tsx"), "utf8");

        expect(propertyBarCropSource).toContain("flipStickerEditDataForFrame");
        expect(propertyBarCropSource).toContain('flipStickerEditDataForFrame(currentUnit.data, currentUnit, axis)');
        expect(transformSource).toContain("export const flipStickerEditDataForFrame");
        expect(transformSource).toContain('type FlipAxis = "x" | "y"');
        expect(bitmapLayersSource).toContain("flipRasterizedAnnotationLayer");
        expect(propertyBarCropSource).toContain("flipRasterizedAnnotationLayer");
        expect(propertyBarCropSource).toContain(
            "captureStickerEditSnapshot(currentUnit, { includeImageData: true })",
        );
        expect(propertyBarCropSource).toContain(
            "if (disposed || !isStickerAsyncEditGuardCurrent(requestGuard, options.unit())) return;",
        );
        expect(propertyBarCropSource).toContain(
            "uiActions.pushStickerHistory(options.unitId(), historySnapshot);",
        );
        expect(imageModelSource).toContain("transform: () => `scale(");
        expect(imageContentSource).toContain("props.transform,");
        expect(imageContentSource).toContain("transform,");
    });
});
