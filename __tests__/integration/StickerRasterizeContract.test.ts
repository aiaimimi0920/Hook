import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const exportSource = readFileSync(resolve(process.cwd(), "src/services/stickerExport.ts"), "utf8");
const rasterizeSource = readFileSync(resolve(process.cwd(), "src/services/stickerRasterize.ts"), "utf8");
const rasterizeActionsSource = readFileSync(resolve(process.cwd(), "src/services/stickerRasterizeActions.ts"), "utf8");
const bitmapLayersSource = readFileSync(resolve(process.cwd(), "src/services/stickerBitmapLayers.ts"), "utf8");
const historySource = readFileSync(resolve(process.cwd(), "src/services/stickerHistory.ts"), "utf8");
const graphStoreSource = readFileSync(resolve(process.cwd(), "src/store/graphStore.ts"), "utf8");
const typeSource = readFileSync(resolve(process.cwd(), "src/types/unit.ts"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");
const syncSource = readFileSync(resolve(process.cwd(), "src/services/syncService.ts"), "utf8");

describe("Hook sticker rasterize contract", () => {
    it("exposes option C: rasterize the selected control or every editable control", () => {
        expect(topStripSource).toContain("栅格化");
        expect(topStripSource).toContain("栅格化全部");
        expect(topStripSource).toContain("selectedStickerAnnotationId");
        expect(topStripSource).toContain("runRasterizeAction");
        expect(topStripSource).toContain("rasterizeStickerAnnotationsForUnit");
        expect(rasterizeActionsSource).toContain("renderStickerBaseLayer");
        expect(rasterizeActionsSource).toContain("renderStickerTransparentAnnotationLayer");
        expect(rasterizeActionsSource).toContain("composeRasterizedStickerPreview");
        expect(rasterizeActionsSource).toContain("createRasterizedStickerData");
        expect(topStripSource).toContain("uiActions.setSelectedStickerAnnotation(null)");
    });

    it("renders only the requested controls into the baked bitmap before removing those controls", () => {
        expect(exportSource).toContain("renderStickerCompositeWithAnnotations");
        expect(exportSource).toContain("renderStickerTransparentAnnotationLayer");
        expect(exportSource).toContain("renderStickerBaseLayer");
        expect(exportSource).toContain("rasterizedAnnotationLayerSrc");
        expect(exportSource).toContain("annotationsOverride");
        expect(rasterizeSource).toContain("getRasterizableAnnotationIds");
        expect(rasterizeSource).toContain("createRasterizedStickerData");
        expect(rasterizeSource).toContain("baseLayerSrc");
        expect(rasterizeSource).toContain("rasterizedAnnotationLayerSrc");
        expect(rasterizeSource).toContain("createEmptyImageEditState()");
    });

    it("keeps rasterization undoable by snapshotting and restoring image source data", () => {
        expect(historySource).toContain("includeImageData");
        expect(historySource).toContain("imageData");
        expect(historySource).toContain("rasterizedAnnotationLayerSrc");
        expect(graphStoreSource).toContain("snapshot.imageData");
        expect(rasterizeActionsSource).toContain("captureStickerEditSnapshot(currentUnit, { includeImageData: true })");
        expect(topStripSource).toContain("captureStickerEditSnapshot(unit, { includeImageData: true })");
    });

    it("stores and displays the rasterized annotation layer as a separate transparent image layer", () => {
        expect(typeSource).toContain("rasterizedAnnotationLayerSrc?: string");
        expect(unitViewSource).toContain("rasterizedAnnotationLayerSrc");
        expect(unitViewSource).toContain("sticker-rasterized-annotation-layer");
        expect(syncSource).toContain("rasterizedAnnotationLayerSrc");
    });

    it("routes the content eraser and its annotation-only switch through bitmap layer editing", () => {
        expect(bitmapLayersSource).toContain("eraseRasterizedAnnotationLayer");
        expect(bitmapLayersSource).toContain("applyContentEraseToBaseLayer");
        expect(bitmapLayersSource).toContain("applyRasterizedContentErase");
        expect(bitmapLayersSource).toContain('globalCompositeOperation = "destination-out"');
        expect(annotationModelSource).toContain('mode: "line" | "polyline" | "arrow" | "brush" | "highlighter" | "content-eraser" | "mosaic" | "blur"');
        expect(annotationLayerSource).toContain("eraseRasterizedAnnotationLayer");
        expect(annotationLayerSource).toContain("applyContentEraseToBaseLayer");
        expect(annotationLayerSource).toContain("applyRasterizedContentErase");
        expect(annotationLayerSource).toContain("commitContentErase");
        expect(annotationLayerSource).toContain("rasterizedAnnotationLayerSrc");
        expect(annotationLayerSource).toContain("contentEraserOnlyAnnotations");
        expect(annotationLayerSource).toContain("beginLiveRasterizedAnnotationErase(point)");
        expect(annotationLayerSource).not.toContain("eraseAtPoint");
        expect(annotationLayerSource).not.toContain("await commitImageStroke(stroke);");
    });

    it("allows the rasterized content eraser to commit a single click dot instead of requiring a two-point stroke", () => {
        expect(annotationLayerSource).toContain("allowsSinglePoint");
        expect(annotationLayerSource).toContain('line.mode === "content-eraser"');
        expect(annotationLayerSource).not.toContain('line.mode === "annotation-eraser"');
        expect(annotationLayerSource).not.toContain("if (line.points.length < 2) return;");
    });

    it("applies content eraser annotation-only strokes while the pointer is dragging", () => {
        expect(annotationLayerSource).toContain("beginLiveRasterizedAnnotationErase");
        expect(annotationLayerSource).toContain("applyLiveRasterizedAnnotationErase");
        expect(annotationLayerSource).toContain("finishLiveRasterizedAnnotationErase");
        expect(annotationLayerSource).toContain('currentDraft?.mode === "content-eraser" && liveRasterizedAnnotationEraseActive');
        expect(annotationLayerSource).toContain("void applyLiveRasterizedAnnotationErase([lastPoint, point])");
        expect(annotationLayerSource).toContain("patchUnitDataLocally");
        expect(annotationLayerSource).not.toContain("await commitRasterizedAnnotationErase(line.points);");
    });

    it("keeps the rasterized annotation layer wired through live default content erase", () => {
        expect(bitmapLayersSource).toContain("applyLiveContentEraseToStickerLayers");
        expect(annotationLayerSource).toContain("applyLiveContentEraseToStickerLayers");
        expect(annotationLayerSource).toContain("liveContentEraseRasterizedAnnotationLayerSrc");
        expect(annotationLayerSource).toContain("rasterizedAnnotationLayerSrc: next.rasterizedAnnotationLayerSrc");
    });
});
