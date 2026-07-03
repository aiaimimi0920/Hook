import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const propertyBarSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStripPropertyBar.tsx"), "utf8");
const toolbarModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerToolbarModel.ts"), "utf8");

describe("Hook sticker crop interaction contract", () => {
    const cropCommitStart = annotationLayerSource.indexOf('if (shape.mode === "crop")');
    const cropCommitEnd = annotationLayerSource.indexOf('if (shape.mode === "mosaic" || shape.mode === "blur")');
    const cropCommitSource = annotationLayerSource.slice(cropCommitStart, cropCommitEnd);

    it("keeps the floating toolbar visible while crop mode is active so crop controls do not disappear", () => {
        expect(unitViewSource).toContain("<StickerTopStrip");
        expect(unitViewSource).not.toContain("<StickerEditToolbar");
        expect(unitViewSource).toContain('props.unit.type === "sticker" && props.isSelected && activeStickerEditTargetId() === props.unit.id');
        expect(annotationLayerSource).toContain('if (shape.mode === "crop")');
        expect(cropCommitSource).not.toContain('uiActions.setStickerEditMode("select");');
        expect(cropCommitSource).not.toContain("setStickerEditMode");
        expect(unitViewSource).toContain('const hasSelectedExistingAnnotations = () =>');
        expect(unitViewSource).toContain('const shouldBlockContainerMouseDown = () => {');
        expect(unitViewSource).toContain('stickerToolSettings.domain !== "existing"');
        expect(unitViewSource).toContain('stickerToolSettings.transformMode !== "select"');
        expect(unitViewSource).toContain('const allowContainerMouseDown = () => !shouldBlockContainerMouseDown();');
        expect(unitViewSource).toContain('if (allowContainerMouseDown()) {');
        expect(annotationLayerSource).toContain("const captureHostPointer = (pointerId: number) => {");
        expect(annotationLayerSource).toContain("hostRef?.setPointerCapture(pointerId);");
        expect(annotationLayerSource).toContain("const releaseHostPointer = () => {");
        expect(annotationLayerSource).toContain("hostRef.releasePointerCapture(pointerId);");
        expect(annotationLayerSource).not.toContain("onPointerLeave={() => void onPointerUp()}");
        expect(annotationLayerSource).toContain("const cropClipped = createMemo(");
        expect(annotationLayerSource).toContain('cropClipped() ? "hidden" : "visible"');
    });

    it("still routes the crop secondary tool to crop controls instead of hiding the whole toolbar", () => {
        const toolbarContractSource = `${topStripSource}\n${propertyBarSource}\n${toolbarModelSource}`;

        expect(toolbarContractSource).toContain('{ id: "geometry", label: "几何"');
        expect(topStripSource).toContain('stickerToolSettings.domain === "sticker" && stickerToolSettings.activeCanvasTool === "crop"');
        expect(topStripSource).toContain('onClick={() => applyTopStripTool("crop")}');
        expect(toolbarModelSource).toContain('if (activeCanvasTool === "crop") return "crop";');
        expect(propertyBarSource).toContain('props.tool === "crop"');
        expect(propertyBarSource).not.toContain("清理改动");
        expect(propertyBarSource).toContain('title="重置裁剪"');
    });

    it("mirrors editable annotations together with crop flip actions instead of flipping only the bitmap", () => {
        const transformSource = readFileSync(resolve(process.cwd(), "src/services/stickerEditTransforms.ts"), "utf8");
        const bitmapLayersSource = readFileSync(resolve(process.cwd(), "src/services/stickerBitmapLayers.ts"), "utf8");
        const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");

        expect(propertyBarSource).toContain("flipStickerEditDataForFrame");
        expect(propertyBarSource).toContain('flipStickerEditDataForFrame(currentUnit.data, currentUnit, axis)');
        expect(transformSource).toContain("export const flipStickerEditDataForFrame");
        expect(transformSource).toContain('type FlipAxis = "x" | "y"');
        expect(bitmapLayersSource).toContain("flipRasterizedAnnotationLayer");
        expect(propertyBarSource).toContain("flipRasterizedAnnotationLayer");
        expect(propertyBarSource).toContain("pushCurrentStickerHistory(true)");
        expect(propertyBarSource).toContain("captureStickerEditSnapshot(currentUnit, includeImageData ? { includeImageData: true } : undefined)");
        expect(unitViewSource).toContain('"transform": getTransform()');
    });
});
