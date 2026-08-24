/** Final sticker export, base-layer and transparent rasterization operations. */
import { graphStore } from "../store/graphStore";
import type { Unit } from "../types/unit";
import { isUnitFormalImagePending } from "./graphImageResolution";
import { drawAnnotationsWithHighlighterLayer } from "./stickerAnnotationLayer";
import { loadImage, resolveFiniteCanvasDimension } from "./stickerCanvas";
import { renderStickerCompositeWithAnnotations } from "./stickerCompositeRenderer";
import { applyStickerExportBeautify } from "./stickerExportBeautify";
import {
    resolveRuntimeDirectStickerExportImageSrc,
    resolveRuntimeStickerCompositeBaseImageSrc,
} from "./stickerExportSource";

export const renderStickerComposite = async (unit: Unit): Promise<string> => {
    if (isUnitFormalImagePending({
        unitId: unit.id,
        units: graphStore.units,
        links: graphStore.links,
        capabilities: graphStore.capabilities,
    })) {
        throw new Error("Formal image output is still processing");
    }

    const directSource = resolveRuntimeDirectStickerExportImageSrc(unit);
    if (directSource) {
        return directSource;
    }

    const composite = await renderStickerCompositeWithAnnotations(
        unit,
        unit.data.annotationState?.elements || [],
        { outputMode: "image-content" },
    );
    return applyStickerExportBeautify(composite, unit);
};

export const renderStickerBaseLayer = async (unit: Unit): Promise<string> =>
    renderStickerCompositeWithAnnotations(unit, [], {
        includeRasterizedAnnotationLayer: false,
    });

export const renderStickerTransparentAnnotationLayer = async (
    unit: Unit,
    annotationIds: string[],
): Promise<string> => {
    const baseSrc =
        resolveRuntimeStickerCompositeBaseImageSrc(unit) ||
        (unit.data.rasterizedAnnotationLayerSrc
            ? unit.data.src
            : unit.data.previewSrc || unit.data.src);
    if (!baseSrc) {
        throw new Error("Sticker has no image source");
    }

    const annotationIdSet = new Set(annotationIds);
    const annotationsOverride = (unit.data.annotationState?.elements || []).filter((annotation) =>
        annotationIdSet.has(annotation.id),
    );

    if (annotationsOverride.length === 0) {
        throw new Error("No sticker annotations to rasterize");
    }

    const renderWidth = resolveFiniteCanvasDimension(unit.w, "sticker width");
    const renderHeight = resolveFiniteCanvasDimension(unit.h, "sticker height");
    const image = await loadImage(baseSrc);
    const canvas = document.createElement("canvas");
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Canvas context unavailable");
    }

    const radius = unit.data.imageEditState?.cornerRadius ?? 0;
    if (radius > 0) {
        context.save();
        context.beginPath();
        context.roundRect(0, 0, renderWidth, renderHeight, radius);
        context.clip();
    }

    if (unit.data.rasterizedAnnotationLayerSrc) {
        const existingLayer = await loadImage(unit.data.rasterizedAnnotationLayerSrc);
        context.drawImage(existingLayer, 0, 0, renderWidth, renderHeight);
    }

    drawAnnotationsWithHighlighterLayer(
        context,
        annotationsOverride,
        image,
        unit,
        renderWidth,
        renderHeight,
    );

    if (radius > 0) {
        context.restore();
    }

    return canvas.toDataURL("image/png");
};

export const renderStickerRasterizedAnnotations = renderStickerTransparentAnnotationLayer;
