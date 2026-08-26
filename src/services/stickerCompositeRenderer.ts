/** Sticker frame and annotation composition into a PNG canvas. */
import type { StickerAnnotation } from "../types/stickerEditing";
import type { Unit } from "../types/unit";
import { drawAnnotationsWithHighlighterLayer } from "./stickerAnnotationLayer";
import { eraseStrokePathToTransparency } from "./stickerAnnotationDrawing";
import { loadImage, resolveFiniteCanvasDimension } from "./stickerCanvas";
import { resolveStickerContentFrame } from "./stickerEditPropagation";
import { resolveRuntimeStickerCompositeBaseImageSrc } from "./stickerExportSource";

const computeContainPlacement = (
    container: { width: number; height: number },
    source: { width: number; height: number },
) => {
    if (source.width <= 0 || source.height <= 0) {
        return {
            left: 0,
            top: 0,
            width: container.width,
            height: container.height,
        };
    }

    const scale = Math.min(container.width / source.width, container.height / source.height);
    const width = source.width * scale;
    const height = source.height * scale;

    return {
        left: (container.width - width) / 2,
        top: (container.height - height) / 2,
        width,
        height,
    };
};

const renderImageContentCanvas = (
    frameCanvas: HTMLCanvasElement,
    placement: { left: number; top: number; width: number; height: number },
    sourceSize: { width: number; height: number },
) => {
    const outputWidth = resolveFiniteCanvasDimension(
        sourceSize.width || placement.width,
        "image-content width",
    );
    const outputHeight = resolveFiniteCanvasDimension(
        sourceSize.height || placement.height,
        "image-content height",
    );
    const alreadyMatchesImageContent =
        Math.abs(placement.left) < 0.001 &&
        Math.abs(placement.top) < 0.001 &&
        Math.abs(placement.width - frameCanvas.width) < 0.001 &&
        Math.abs(placement.height - frameCanvas.height) < 0.001 &&
        outputWidth === frameCanvas.width &&
        outputHeight === frameCanvas.height;
    if (alreadyMatchesImageContent) {
        return frameCanvas;
    }

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) {
        throw new Error("Canvas context unavailable");
    }
    outputContext.drawImage(
        frameCanvas,
        placement.left,
        placement.top,
        placement.width,
        placement.height,
        0,
        0,
        outputWidth,
        outputHeight,
    );
    return outputCanvas;
};

export const renderStickerCompositeWithAnnotations = async (
    unit: Unit,
    annotationsOverride: StickerAnnotation[],
    options?: {
        includeRasterizedAnnotationLayer?: boolean;
        baseImageSrcOverride?: string;
        outputMode?: "frame" | "image-content" | "source-resolution";
    },
): Promise<string> => {
    const baseSrc =
        options?.baseImageSrcOverride ||
        resolveRuntimeStickerCompositeBaseImageSrc(unit) ||
        (unit.data.rasterizedAnnotationLayerSrc
            ? unit.data.src
            : unit.data.previewSrc || unit.data.src);
    if (!baseSrc) {
        throw new Error("Sticker has no image source");
    }

    const renderWidth = resolveFiniteCanvasDimension(unit.w, "sticker width");
    const renderHeight = resolveFiniteCanvasDimension(unit.h, "sticker height");
    const image = await loadImage(baseSrc);
    const cropRect = unit.data.imageEditState?.cropRect;
    const contentFrame = resolveStickerContentFrame(unit);
    const sourceSize = {
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
    };
    const preserveSourceResolution = options?.outputMode === "source-resolution";
    const outputWidth = preserveSourceResolution
        ? resolveFiniteCanvasDimension(sourceSize.width || renderWidth, "source width")
        : renderWidth;
    const outputHeight = preserveSourceResolution
        ? resolveFiniteCanvasDimension(sourceSize.height || renderHeight, "source height")
        : renderHeight;
    const coordinateScale = {
        x: outputWidth / renderWidth,
        y: outputHeight / renderHeight,
    };
    let baseImagePlacement = {
        left: contentFrame.x,
        top: contentFrame.y,
        width: contentFrame.w,
        height: contentFrame.h,
    };

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Canvas context unavailable");
    }
    if (preserveSourceResolution && (coordinateScale.x !== 1 || coordinateScale.y !== 1)) {
        context.scale(coordinateScale.x, coordinateScale.y);
    }

    const radius = unit.data.imageEditState?.cornerRadius ?? 0;
    if (radius > 0) {
        context.save();
        context.beginPath();
        context.roundRect(0, 0, renderWidth, renderHeight, radius);
        context.clip();
    }

    context.save();
    context.globalAlpha = unit.data.opacityNormal ?? 1;
    if (unit.data.imageEditState?.flippedX || unit.data.imageEditState?.flippedY) {
        context.translate(unit.data.imageEditState?.flippedX ? renderWidth : 0, unit.data.imageEditState?.flippedY ? renderHeight : 0);
        context.scale(unit.data.imageEditState?.flippedX ? -1 : 1, unit.data.imageEditState?.flippedY ? -1 : 1);
    }

    if (cropRect) {
        context.drawImage(
            image,
            cropRect.x,
            cropRect.y,
            cropRect.w,
            cropRect.h,
            contentFrame.x,
            contentFrame.y,
            contentFrame.w,
            contentFrame.h,
        );
    } else {
        const containedPlacement = computeContainPlacement(
            { width: contentFrame.w, height: contentFrame.h },
            sourceSize,
        );
        baseImagePlacement = {
            left: contentFrame.x + containedPlacement.left,
            top: contentFrame.y + containedPlacement.top,
            width: containedPlacement.width,
            height: containedPlacement.height,
        };
        context.drawImage(
            image,
            baseImagePlacement.left,
            baseImagePlacement.top,
            baseImagePlacement.width,
            baseImagePlacement.height,
        );
    }
    context.restore();

    for (const stroke of unit.data.imageEditState?.contentEraseStrokes || []) {
        eraseStrokePathToTransparency(context, stroke.points, stroke.width);
    }

    const borderWidth = unit.data.imageEditState?.borderWidth ?? 0;
    const borderColor = unit.data.imageEditState?.borderColor;
    if (borderWidth > 0 && borderColor) {
        context.save();
        context.strokeStyle = borderColor;
        context.lineWidth = borderWidth;
        const inset = borderWidth / 2;
        context.strokeRect(
            inset,
            inset,
            Math.max(0, renderWidth - borderWidth),
            Math.max(0, renderHeight - borderWidth),
        );
        context.restore();
    }

    if (options?.includeRasterizedAnnotationLayer !== false && unit.data.rasterizedAnnotationLayerSrc) {
        const annotationLayer = await loadImage(unit.data.rasterizedAnnotationLayerSrc);
        context.drawImage(annotationLayer, 0, 0, renderWidth, renderHeight);
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

    const drawsRasterizedAnnotationLayer =
        options?.includeRasterizedAnnotationLayer !== false &&
        !!unit.data.rasterizedAnnotationLayerSrc;
    const canUseImageContentSize =
        options?.outputMode === "image-content" &&
        !cropRect &&
        annotationsOverride.length === 0 &&
        !drawsRasterizedAnnotationLayer &&
        borderWidth <= 0;
    const outputCanvas = canUseImageContentSize
        ? renderImageContentCanvas(canvas, baseImagePlacement, sourceSize)
        : canvas;

    return outputCanvas.toDataURL("image/png");
};
