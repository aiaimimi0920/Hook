/** Final sticker export, base-layer and transparent rasterization operations. */
import { graphStore } from "../store/graphStore";
import type { Unit } from "../types/unit";
import { isUnitFormalImagePending } from "./graphImageResolution";
import { drawAnnotationsWithHighlighterLayer } from "./stickerAnnotationLayer";
import { loadImage, resolveFiniteCanvasDimension } from "./stickerCanvas";
import { renderStickerCompositeWithAnnotations } from "./stickerCompositeRenderer";
import { applyStickerExportBeautify } from "./stickerExportBeautify";
import { prepareLiveCaptureUnitSnapshot } from "./liveCaptureUnit";
import {
    resolveRuntimeDirectStickerExportImageSrc,
    resolveRuntimeStickerCompositeBaseImageSrc,
} from "./stickerExportSource";

export const renderStickerComposite = async (
    unit: Unit,
    options: { liveSnapshotPrepared?: boolean } = {},
): Promise<string> => {
    const pendingSnapshot = options.liveSnapshotPrepared ? undefined : prepareLiveCaptureUnitSnapshot(unit.id);
    const liveSource = pendingSnapshot ? await pendingSnapshot : undefined;
    // Drag export can pass a captured Unit object instead of the current store proxy.
    if (liveSource) unit = { ...unit, data: { ...unit.data, src: liveSource, previewSrc: undefined, filePath: undefined } };
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
        outputMode: "source-resolution",
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

    const image = await loadImage(baseSrc);
    const renderWidth = resolveFiniteCanvasDimension(unit.w, "sticker width");
    const renderHeight = resolveFiniteCanvasDimension(unit.h, "sticker height");
    const outputWidth = resolveFiniteCanvasDimension(
        image.naturalWidth || image.width || renderWidth,
        "source width",
    );
    const outputHeight = resolveFiniteCanvasDimension(
        image.naturalHeight || image.height || renderHeight,
        "source height",
    );
    const coordinateScale = {
        x: outputWidth / renderWidth,
        y: outputHeight / renderHeight,
    };
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Canvas context unavailable");
    }
    if (coordinateScale.x !== 1 || coordinateScale.y !== 1) {
        context.scale(coordinateScale.x, coordinateScale.y);
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
        coordinateScale,
    );

    if (radius > 0) {
        context.restore();
    }

    return canvas.toDataURL("image/png");
};

export const renderStickerRasterizedAnnotations = renderStickerTransparentAnnotationLayer;
