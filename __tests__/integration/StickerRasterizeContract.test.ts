import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const topStripSource = readFileSync(resolve(process.cwd(), "src/components/StickerTopStrip.tsx"), "utf8");
const topStripCatalogPath = resolve(process.cwd(), "src/components/stickerTopStripCatalog.tsx");
const topStripCatalogSource = existsSync(topStripCatalogPath) ? readFileSync(topStripCatalogPath, "utf8") : "";
const topStripEditActionsSource = readFileSync(
    resolve(process.cwd(), "src/components/StickerTopStripEditActions.tsx"),
    "utf8",
);
const topStripRenderSource = `${topStripEditActionsSource}\n${topStripCatalogSource}`;
const exportSource = [
    "src/services/stickerExport.ts",
    "src/services/stickerCompositeRenderer.ts",
    "src/services/stickerExportOperations.ts",
].map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");
const rasterizeSource = readFileSync(resolve(process.cwd(), "src/services/stickerRasterize.ts"), "utf8");
const rasterizeActionsSource = readFileSync(resolve(process.cwd(), "src/services/stickerRasterizeActions.ts"), "utf8");
const bitmapLayersSource = readFileSync(resolve(process.cwd(), "src/services/stickerBitmapLayers.ts"), "utf8");
const historySource = readFileSync(resolve(process.cwd(), "src/services/stickerHistory.ts"), "utf8");
const graphStoreSource = readFileSync(resolve(process.cwd(), "src/store/graphStore.ts"), "utf8");
const typeSource = readFileSync(resolve(process.cwd(), "src/types/unit.ts"), "utf8");
const unitViewSource = readFileSync(resolve(process.cwd(), "src/components/UnitView.tsx"), "utf8");
const annotationLayerSource = readFileSync(resolve(process.cwd(), "src/components/StickerAnnotationLayer.tsx"), "utf8");
const annotationEraseSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationEraseController.ts"),
    "utf8",
);
const annotationPointerCommitSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationPointerCommitController.ts"),
    "utf8",
);
const annotationPointerDownSource = readFileSync(
    resolve(process.cwd(), "src/components/stickerAnnotationPointerDownController.ts"),
    "utf8",
);
const annotationModelSource = readFileSync(resolve(process.cwd(), "src/components/stickerAnnotationModel.ts"), "utf8");
// The session-load mapping (which carries rasterizedAnnotationLayerSrc onto the
// restored unit) was extracted from syncService.ts into its own module.
const sessionMappingSource = readFileSync(resolve(process.cwd(), "src/services/sessionStickerMapping.ts"), "utf8");

describe("Hook sticker rasterize contract", () => {
    it("exposes option C: rasterize the selected control or every editable control", () => {
        expect(topStripRenderSource).toContain("栅格化");
        expect(topStripRenderSource).toContain("栅格化全部");
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
        const imageContentSource = readFileSync(resolve(process.cwd(), "src/components/UnitStickerImageContent.tsx"), "utf8");
        expect(imageContentSource).toContain("rasterizedAnnotationLayerSrc");
        expect(imageContentSource).toContain("sticker-rasterized-annotation-layer");
        expect(sessionMappingSource).toContain("rasterizedAnnotationLayerSrc");
    });

    it("routes the content eraser and its annotation-only switch through bitmap layer editing", () => {
        expect(bitmapLayersSource).toContain("eraseRasterizedAnnotationLayer");
        expect(bitmapLayersSource).toContain("applyContentEraseToBaseLayer");
        expect(bitmapLayersSource).toContain("applyRasterizedContentErase");
        expect(bitmapLayersSource).toContain('globalCompositeOperation = "destination-out"');
        expect(annotationModelSource).toContain('mode: "line" | "polyline" | "arrow" | "brush" | "highlighter" | "content-eraser" | "mosaic" | "blur"');
        expect(annotationEraseSource).toContain("createLiveStickerEraseSession");
        expect(annotationEraseSource).toContain("applyContentEraseToBaseLayer");
        expect(annotationEraseSource).toContain("applyRasterizedContentErase");
        expect(annotationPointerCommitSource).toContain("commitContentErase");
        expect(annotationEraseSource).toContain("rasterizedAnnotationLayerSrc");
        expect(annotationPointerDownSource).toContain("contentEraserOnlyAnnotations");
        expect(annotationPointerDownSource).toContain("beginLiveRasterizedAnnotationErase(point)");
        expect(annotationPointerDownSource).not.toContain("eraseAtPoint");
        expect(annotationPointerDownSource).not.toContain("await commitImageStroke(stroke);");
    });

    it("allows the rasterized content eraser to commit a single click dot instead of requiring a two-point stroke", () => {
        expect(annotationPointerCommitSource).toContain("allowsSinglePoint");
        expect(annotationPointerCommitSource).toContain('line.mode === "content-eraser"');
        expect(annotationPointerCommitSource).not.toContain('line.mode === "annotation-eraser"');
        expect(annotationPointerCommitSource).not.toContain("if (line.points.length < 2) return;");
    });

    it("applies content eraser annotation-only strokes while the pointer is dragging", () => {
        expect(annotationEraseSource).toContain("createLiveStickerEraseSession");
        expect(annotationEraseSource).toContain("liveEraseSession.queueErase");
        expect(annotationEraseSource).toContain("session.finish()");
        expect(annotationEraseSource).toContain('beginLiveErase("annotations", point)');
        expect(annotationEraseSource).not.toContain("patchUnitDataLocally");
        expect(annotationEraseSource).not.toContain("eraseRasterizedAnnotationLayer");
        expect(annotationEraseSource).not.toContain("applyLiveContentEraseToStickerLayers");
        expect(annotationLayerSource).not.toContain("await commitRasterizedAnnotationErase(line.points);");
    });

    it("keeps live content erase on a canvas preview and encodes bitmap state only when the stroke finishes", () => {
        expect(bitmapLayersSource).toContain("export class LiveStickerEraseSession");
        expect(bitmapLayersSource).toContain("requestFrame(() => {");
        expect(bitmapLayersSource).toContain('this.baseCanvas.toDataURL("image/png")');
        expect(annotationEraseSource).toContain('data-live-erase-preview');
        expect(annotationLayerSource).toContain("setLiveErasePreviewRef");
        expect(annotationEraseSource).toContain(
            "rasterizedAnnotationLayerSrc: result.rasterizedAnnotationLayerSrc",
        );
    });
});
