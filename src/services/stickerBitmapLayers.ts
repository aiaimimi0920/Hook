import type { ContentEraserStroke, StickerPoint } from "../types/stickerEditing";
import { drawStrokePath, loadImage } from "./stickerCanvas";

type StickerBitmapSize = { w: number; h: number };
type FlipAxis = "x" | "y";

const createCanvas = (size: StickerBitmapSize) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(size.w));
    canvas.height = Math.max(1, Math.round(size.h));
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("Canvas context unavailable");
    }
    return { canvas, context };
};

const eraseStrokePathToTransparency = (
    context: CanvasRenderingContext2D,
    points: StickerPoint[],
    width: number,
) => {
    context.save();
    context.globalCompositeOperation = "destination-out";
    drawStrokePath(context, points, {
        color: "#000000",
        width,
        opacity: 1,
    });
    context.restore();
};

export const composeRasterizedStickerPreview = async (
    baseLayerSrc: string,
    rasterizedAnnotationLayerSrc: string | undefined,
    size: StickerBitmapSize,
) => {
    const { canvas, context } = createCanvas(size);
    const baseImage = await loadImage(baseLayerSrc);
    context.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

    if (rasterizedAnnotationLayerSrc) {
        const annotationLayer = await loadImage(rasterizedAnnotationLayerSrc);
        context.drawImage(annotationLayer, 0, 0, canvas.width, canvas.height);
    }

    return canvas.toDataURL("image/png");
};

export const eraseRasterizedAnnotationLayer = async (params: {
    rasterizedAnnotationLayerSrc: string;
    size: StickerBitmapSize;
    points: StickerPoint[];
    width: number;
}) => {
    const { canvas, context } = createCanvas(params.size);
    const annotationLayer = await loadImage(params.rasterizedAnnotationLayerSrc);
    context.drawImage(annotationLayer, 0, 0, canvas.width, canvas.height);

    eraseStrokePathToTransparency(context, params.points, params.width);

    return canvas.toDataURL("image/png");
};

export const flipRasterizedAnnotationLayer = async (params: {
    rasterizedAnnotationLayerSrc: string;
    size: StickerBitmapSize;
    axis: FlipAxis;
}) => {
    const { canvas, context } = createCanvas(params.size);
    const annotationLayer = await loadImage(params.rasterizedAnnotationLayerSrc);

    context.save();
    if (params.axis === "x") {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
    } else {
        context.translate(0, canvas.height);
        context.scale(1, -1);
    }
    context.drawImage(annotationLayer, 0, 0, canvas.width, canvas.height);
    context.restore();

    return canvas.toDataURL("image/png");
};

export const applyContentEraseToBaseLayer = async (params: {
    baseLayerSrc: string;
    size: StickerBitmapSize;
    stroke: Pick<ContentEraserStroke, "points" | "width">;
}) => {
    const { canvas, context } = createCanvas(params.size);
    const baseImage = await loadImage(params.baseLayerSrc);
    context.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
    eraseStrokePathToTransparency(context, params.stroke.points, params.stroke.width);
    return canvas.toDataURL("image/png");
};

export const applyLiveContentEraseToStickerLayers = async (params: {
    baseLayerSrc: string;
    rasterizedAnnotationLayerSrc?: string;
    size: StickerBitmapSize;
    stroke: Pick<ContentEraserStroke, "points" | "color" | "width" | "opacity">;
}) => {
    const baseLayerSrc = await applyContentEraseToBaseLayer({
        baseLayerSrc: params.baseLayerSrc,
        size: params.size,
        stroke: params.stroke,
    });

    const rasterizedAnnotationLayerSrc = params.rasterizedAnnotationLayerSrc
        ? await eraseRasterizedAnnotationLayer({
              rasterizedAnnotationLayerSrc: params.rasterizedAnnotationLayerSrc,
              size: params.size,
              points: params.stroke.points,
              width: params.stroke.width,
          })
        : undefined;

    const previewSrc = await composeRasterizedStickerPreview(
        baseLayerSrc,
        rasterizedAnnotationLayerSrc,
        params.size,
    );

    return {
        baseLayerSrc,
        rasterizedAnnotationLayerSrc,
        previewSrc,
    };
};

export const applyRasterizedContentErase = async (params: {
    baseLayerSrc: string;
    rasterizedAnnotationLayerSrc: string;
    size: StickerBitmapSize;
    stroke: Pick<ContentEraserStroke, "points" | "color" | "width" | "opacity">;
}) => {
    const baseLayerSrc = await applyContentEraseToBaseLayer({
        baseLayerSrc: params.baseLayerSrc,
        size: params.size,
        stroke: params.stroke,
    });

    const rasterizedAnnotationLayerSrc = await eraseRasterizedAnnotationLayer({
        rasterizedAnnotationLayerSrc: params.rasterizedAnnotationLayerSrc,
        size: params.size,
        points: params.stroke.points,
        width: params.stroke.width,
    });
    const previewSrc = await composeRasterizedStickerPreview(
        baseLayerSrc,
        rasterizedAnnotationLayerSrc,
        params.size,
    );

    return {
        baseLayerSrc,
        rasterizedAnnotationLayerSrc,
        previewSrc,
    };
};
