import type { ContentEraserStroke, StickerPoint } from "../types/stickerEditing";
import { drawStrokePath, loadImage } from "./stickerCanvas";

type StickerBitmapSize = { w: number; h: number };
type FlipAxis = "x" | "y";
export type LiveStickerEraseMode = "annotations" | "content";

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

const requestFrame = (callback: FrameRequestCallback) =>
    typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(callback)
        : (setTimeout(() => callback(Date.now()), 16) as unknown as number);

const cancelFrame = (frameId: number) => {
    if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frameId);
        return;
    }
    clearTimeout(frameId);
};

export interface LiveStickerEraseResult {
    baseLayerSrc: string;
    rasterizedAnnotationLayerSrc?: string;
    previewSrc: string;
}

export class LiveStickerEraseSession {
    private pendingPoints: StickerPoint[] = [];
    private pendingWidth = 1;
    private frameId: number | null = null;

    constructor(
        readonly mode: LiveStickerEraseMode,
        private readonly originalBaseLayerSrc: string,
        private readonly baseCanvas: HTMLCanvasElement,
        private readonly baseContext: CanvasRenderingContext2D,
        private readonly annotationCanvas: HTMLCanvasElement | null,
        private readonly annotationContext: CanvasRenderingContext2D | null,
        readonly previewCanvas: HTMLCanvasElement,
        private readonly previewContext: CanvasRenderingContext2D,
    ) {}

    queueErase(points: StickerPoint[], width: number) {
        if (points.length < 1) return;
        this.pendingPoints.push(...points);
        this.pendingWidth = width;
        if (this.frameId === null) {
            this.frameId = requestFrame(() => {
                this.frameId = null;
                this.flush();
            });
        }
    }

    flush() {
        if (this.pendingPoints.length > 0) {
            const points = this.pendingPoints;
            this.pendingPoints = [];
            if (this.mode === "content") {
                eraseStrokePathToTransparency(this.baseContext, points, this.pendingWidth);
            }
            if (this.annotationContext) {
                eraseStrokePathToTransparency(this.annotationContext, points, this.pendingWidth);
            }
        }

        this.previewContext.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        this.previewContext.drawImage(
            this.baseCanvas,
            0,
            0,
            this.previewCanvas.width,
            this.previewCanvas.height,
        );
        if (this.annotationCanvas) {
            this.previewContext.drawImage(
                this.annotationCanvas,
                0,
                0,
                this.previewCanvas.width,
                this.previewCanvas.height,
            );
        }
    }

    finish(): LiveStickerEraseResult {
        if (this.frameId !== null) {
            cancelFrame(this.frameId);
            this.frameId = null;
        }
        this.flush();
        return {
            baseLayerSrc:
                this.mode === "content"
                    ? this.baseCanvas.toDataURL("image/png")
                    : this.originalBaseLayerSrc,
            rasterizedAnnotationLayerSrc:
                this.annotationCanvas?.toDataURL("image/png"),
            previewSrc: this.previewCanvas.toDataURL("image/png"),
        };
    }

    destroy() {
        if (this.frameId !== null) {
            cancelFrame(this.frameId);
            this.frameId = null;
        }
        this.pendingPoints = [];
    }
}

export const createLiveStickerEraseSession = async (params: {
    mode: LiveStickerEraseMode;
    baseLayerSrc: string;
    rasterizedAnnotationLayerSrc?: string;
    size: StickerBitmapSize;
    previewCanvas: HTMLCanvasElement;
}) => {
    const baseLayer = createCanvas(params.size);
    const baseImage = await loadImage(params.baseLayerSrc);
    baseLayer.context.drawImage(baseImage, 0, 0, baseLayer.canvas.width, baseLayer.canvas.height);

    let annotationLayer: ReturnType<typeof createCanvas> | null = null;
    if (params.rasterizedAnnotationLayerSrc) {
        annotationLayer = createCanvas(params.size);
        const annotationImage = await loadImage(params.rasterizedAnnotationLayerSrc);
        annotationLayer.context.drawImage(
            annotationImage,
            0,
            0,
            annotationLayer.canvas.width,
            annotationLayer.canvas.height,
        );
    }

    params.previewCanvas.width = baseLayer.canvas.width;
    params.previewCanvas.height = baseLayer.canvas.height;
    const previewContext = params.previewCanvas.getContext("2d");
    if (!previewContext) {
        throw new Error("Live erase preview canvas context unavailable");
    }

    const session = new LiveStickerEraseSession(
        params.mode,
        params.baseLayerSrc,
        baseLayer.canvas,
        baseLayer.context,
        annotationLayer?.canvas ?? null,
        annotationLayer?.context ?? null,
        params.previewCanvas,
        previewContext,
    );
    session.flush();
    return session;
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
