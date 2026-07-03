import type { Unit } from "../types/unit";
import type {
    StickerAnnotation,
    StickerEffectAnnotation,
    StickerLineAnnotation,
    StickerPoint,
    StickerShapeAnnotation,
    StickerTextAnnotation,
} from "../types/stickerEditing";
import {
    BLUR_EFFECT_OVERLAY_FILL,
    computeEffectSourceProjection,
    paintMosaicGrid,
    renderBlurToCanvas,
} from "./stickerEffects";
import {
    buildSerialAnnotationMetrics,
    HIGHLIGHTER_LAYER_OPACITY,
    isTransparentStickerColor,
} from "./stickerEditing";
import {
    computeBeautifyLayout,
    paintBeautifyBackground,
    resolveBeautifyBackground,
} from "./stickerBeautify";
import {
    buildPolygonPoints,
    buildTrianglePoints,
    getAnnotationCenter,
    traceRoundedPolygonPath,
} from "./stickerGeometry";
import { loadImage, drawStrokePath, applyLineDash } from "./stickerCanvas";

// Render-order rank, mirrored from stickerAnnotationModel.annotationRenderRank
// (kept inline to avoid a services→components dependency). Blur sits below
// mosaic so a blur brush never paints over a mosaic censoring the same pixels.
const annotationRenderRank = (type: string) =>
    type === "blur" ? 0 : type === "mosaic" ? 1 : 2;

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

const drawArrowHead = (context: CanvasRenderingContext2D, line: StickerLineAnnotation) => {
    if (line.points.length < 2) return;
    const end = line.points[line.points.length - 1];
    const start = line.points[line.points.length - 2];
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = Math.max(10, line.style.width * 2.4);

    context.save();
    context.translate(end.x, end.y);
    context.rotate(angle);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(-size, size / 2);
    context.lineTo(-size, -size / 2);
    context.closePath();
    context.fillStyle = line.style.color;
    context.globalAlpha = line.style.opacity ?? 1;
    context.fill();
    context.restore();
};

const shouldDrawShapeStroke = (shape: StickerShapeAnnotation) =>
    shape.style.width > 0 && !isTransparentStickerColor(shape.style.color);

const shouldDrawShapeFill = (shape: StickerShapeAnnotation) =>
    !!shape.style.fill && !isTransparentStickerColor(shape.style.fill);

const getShapeCornerRadius = (shape: StickerShapeAnnotation) =>
    shape.style.cornerRadius ?? (shape.type === "round-rect" ? 12 : 0);

const applyAnnotationRotation = (
    context: CanvasRenderingContext2D,
    annotation: StickerShapeAnnotation | StickerTextAnnotation | StickerEffectAnnotation,
) => {
    if (!annotation.rotation) return;
    const center = getAnnotationCenter(annotation);
    context.translate(center.x, center.y);
    context.rotate((annotation.rotation * Math.PI) / 180);
    context.translate(-center.x, -center.y);
};

const drawAnnotation = (
    context: CanvasRenderingContext2D,
    annotation: StickerAnnotation,
    sourceImage: HTMLImageElement,
    unit: Unit,
) => {
    switch (annotation.type) {
        case "rect":
        case "round-rect":
        case "ellipse": {
            const shape = annotation as StickerShapeAnnotation;
            context.save();
            applyAnnotationRotation(context, shape);
            context.strokeStyle = shape.style.color;
            context.lineWidth = shape.style.width;
            context.globalAlpha = shape.style.opacity ?? 1;
            applyLineDash(context, shape.style.dashPattern, shape.style.width);
            if (shape.type === "ellipse") {
                context.beginPath();
                context.ellipse(
                    shape.x + shape.w / 2,
                    shape.y + shape.h / 2,
                    shape.w / 2,
                    shape.h / 2,
                    0,
                    0,
                    Math.PI * 2,
                );
                if (shouldDrawShapeFill(shape)) {
                    context.fillStyle = shape.style.fill!;
                    context.fill();
                }
                if (shouldDrawShapeStroke(shape)) {
                    context.stroke();
                }
            } else if (shape.type === "round-rect" || getShapeCornerRadius(shape) > 0) {
                context.beginPath();
                const radius = getShapeCornerRadius(shape);
                context.roundRect(shape.x, shape.y, shape.w, shape.h, radius);
                if (shouldDrawShapeFill(shape)) {
                    context.fillStyle = shape.style.fill!;
                    context.fill();
                }
                if (shouldDrawShapeStroke(shape)) {
                    context.stroke();
                }
            } else {
                if (shouldDrawShapeFill(shape)) {
                    context.fillStyle = shape.style.fill!;
                    context.fillRect(shape.x, shape.y, shape.w, shape.h);
                }
                if (shouldDrawShapeStroke(shape)) {
                    context.strokeRect(shape.x, shape.y, shape.w, shape.h);
                }
            }
            context.restore();
            return;
        }
        case "triangle":
        case "polygon": {
            const shape = annotation as StickerShapeAnnotation;
            context.save();
            applyAnnotationRotation(context, shape);
            context.strokeStyle = shape.style.color;
            context.lineWidth = shape.style.width;
            context.globalAlpha = shape.style.opacity ?? 1;
            context.lineJoin = "round";
            applyLineDash(context, shape.style.dashPattern, shape.style.width);

            const polygonPoints =
                shape.type === "triangle"
                    ? buildTrianglePoints(shape)
                    : buildPolygonPoints(shape, shape.sides ?? 6);
            traceRoundedPolygonPath(context, polygonPoints, getShapeCornerRadius(shape));
            if (shouldDrawShapeFill(shape)) {
                context.fillStyle = shape.style.fill!;
                context.fill();
            }
            if (shouldDrawShapeStroke(shape)) {
                context.stroke();
            }
            context.restore();
            return;
        }
        case "line":
        case "polyline":
        case "brush":
        case "highlighter":
        case "arrow": {
            const line = annotation as StickerLineAnnotation;
            drawStrokePath(context, line.points, line.style);
            if (annotation.type === "arrow") {
                drawArrowHead(context, line);
            }
            return;
        }
        case "text":
        case "serial": {
            const text = annotation as StickerTextAnnotation;
            context.save();
            const serialMetrics = buildSerialAnnotationMetrics(text.style.cornerRadius ?? 14);
            const fontSize = text.fontSize ?? (annotation.type === "serial" ? serialMetrics.fontSize : 18);
            context.font = `${annotation.type === "serial" ? "700" : "500"} ${fontSize}px "${text.fontFamily || "Segoe UI"}", sans-serif`;
            context.textBaseline = annotation.type === "serial" ? "middle" : "top";
            applyAnnotationRotation(context, text);
            if (annotation.type === "serial") {
                const serialCenterY = text.y - fontSize / 2;
                if (!isTransparentStickerColor(text.style.fill)) {
                    context.fillStyle = text.style.fill || "#000000";
                    context.beginPath();
                    context.arc(text.x + serialMetrics.radius, serialCenterY, serialMetrics.radius, 0, Math.PI * 2);
                    context.fill();
                }
                if (!isTransparentStickerColor(text.style.color) && (text.style.width || serialMetrics.borderWidth) > 0) {
                    context.strokeStyle = text.style.color;
                    context.lineWidth = text.style.width || serialMetrics.borderWidth;
                    context.beginPath();
                    context.arc(text.x + serialMetrics.radius, serialCenterY, serialMetrics.radius, 0, Math.PI * 2);
                    context.stroke();
                }
                context.fillStyle = text.style.color;
                const measure = context.measureText(text.text);
                context.fillText(text.text, text.x + serialMetrics.radius - measure.width / 2, serialCenterY);
            } else {
                context.fillStyle = text.style.color;
                context.fillText(text.text, text.x, text.y);
            }
            context.restore();
            return;
        }
        case "mosaic":
        case "blur": {
            const effect = annotation as StickerEffectAnnotation;
            // Brush-stroke effects: render the full mosaic/blur over the stroke
            // bounding box into an offscreen layer, then keep only the painted
            // region by masking with the brush stroke (destination-in), and
            // composite the masked result back onto the main canvas.
            const boxW = Math.max(1, Math.ceil(effect.w));
            const boxH = Math.max(1, Math.ceil(effect.h));
            const points = effect.points ?? [];
            const brushWidth = Math.max(1, effect.brushWidth ?? effect.style.width ?? 12);

            const layer = document.createElement("canvas");
            layer.width = boxW;
            layer.height = boxH;
            const layerContext = layer.getContext("2d");
            if (!layerContext) {
                return;
            }

            // The layer is in box-local coordinates, so shift the projection by
            // -effect.x/-effect.y instead of +effect.x/+effect.y.
            const projection = computeEffectSourceProjection(
                { x: effect.x, y: effect.y, w: effect.w, h: effect.h },
                { w: unit.w, h: unit.h },
                { w: sourceImage.width, h: sourceImage.height },
                unit.data.imageEditState,
            );

            // Trace the brush stroke in box-local coordinates so both the mosaic
            // pattern stroke and the blur mask follow the painted path.
            const traceStrokePath = () => {
                layerContext.beginPath();
                if (points.length === 1) {
                    // Single tap: a round cap dot. Drawn as a 0-length segment so
                    // the round line cap paints a circle.
                    layerContext.moveTo(points[0].x - effect.x, points[0].y - effect.y);
                    layerContext.lineTo(points[0].x - effect.x + 0.01, points[0].y - effect.y);
                } else {
                    layerContext.moveTo(points[0].x - effect.x, points[0].y - effect.y);
                    for (let i = 1; i < points.length; i += 1) {
                        layerContext.lineTo(points[i].x - effect.x, points[i].y - effect.y);
                    }
                }
            };

            if (effect.type === "mosaic") {
                // Mosaic: paint a grid of square cells whose colors come from each
                // cell's ABSOLUTE sticker position (so the grid never repeats), then
                // mask it down to the brush stroke via destination-in. The cells
                // NEVER sample the underlying image, so the censored content cannot
                // leak. The box origin (effect.x/effect.y) is passed so the export
                // cells align to the same absolute grid as the live overlay.
                paintMosaicGrid(
                    layerContext,
                    boxW,
                    boxH,
                    Math.max(2, Math.round(effect.strength || 12)),
                    effect.x,
                    effect.y,
                );

                if (points.length > 0) {
                    layerContext.save();
                    layerContext.globalCompositeOperation = "destination-in";
                    layerContext.strokeStyle = "#000000";
                    layerContext.lineWidth = brushWidth;
                    layerContext.lineCap = "round";
                    layerContext.lineJoin = "round";
                    traceStrokePath();
                    layerContext.stroke();
                    layerContext.restore();
                }
            } else {
                // Blur: render the blurred source over the box, tint it, then mask
                // it down to the brush stroke via destination-in.
                if (projection) {
                    renderBlurToCanvas(
                        layerContext,
                        sourceImage,
                        projection,
                        effect.strength || 8,
                    );
                }
                layerContext.fillStyle = BLUR_EFFECT_OVERLAY_FILL;
                layerContext.fillRect(0, 0, boxW, boxH);

                if (points.length > 0) {
                    layerContext.save();
                    layerContext.globalCompositeOperation = "destination-in";
                    layerContext.strokeStyle = "#000000";
                    layerContext.lineWidth = brushWidth;
                    layerContext.lineCap = "round";
                    layerContext.lineJoin = "round";
                    traceStrokePath();
                    layerContext.stroke();
                    layerContext.restore();
                }
            }

            context.save();
            applyAnnotationRotation(context, effect);
            context.drawImage(layer, effect.x, effect.y);
            context.restore();
            return;
        }
    }
};

const drawAnnotationsWithHighlighterLayer = (
    context: CanvasRenderingContext2D,
    annotations: StickerAnnotation[],
    sourceImage: HTMLImageElement,
    unit: Unit,
    layerWidth: number,
    layerHeight: number,
) => {
    // Censoring effects sit at the bottom and blur renders below mosaic, so a
    // blur brush can never paint over (and erase) a mosaic covering the same
    // pixels. Rank is the primary key; zIndex preserves the within-rank order.
    const sorted = [...annotations].sort(
        (a, b) => annotationRenderRank(a.type) - annotationRenderRank(b.type) || a.zIndex - b.zIndex,
    );
    const highlighters = sorted.filter(
        (annotation): annotation is StickerLineAnnotation => annotation.type === "highlighter",
    );

    // Composite all highlighter strokes through one offscreen layer at full
    // opacity, then blit the layer once at HIGHLIGHTER_LAYER_OPACITY. This
    // prevents overlapping/self-crossing strokes from compounding their alpha
    // and matches the live <g opacity> rendering. The wash sits beneath the
    // other annotations, mirroring the live layer order.
    if (highlighters.length > 0 && layerWidth > 0 && layerHeight > 0) {
        const layer = document.createElement("canvas");
        layer.width = layerWidth;
        layer.height = layerHeight;
        const layerContext = layer.getContext("2d");
        if (layerContext) {
            for (const highlighter of highlighters) {
                drawStrokePath(layerContext, highlighter.points, {
                    color: highlighter.style.color,
                    width: highlighter.style.width,
                    opacity: 1,
                });
            }
            context.save();
            context.globalAlpha = HIGHLIGHTER_LAYER_OPACITY;
            context.drawImage(layer, 0, 0);
            context.restore();
        }
    }

    for (const annotation of sorted) {
        if (annotation.type === "highlighter") continue;
        drawAnnotation(context, annotation, sourceImage, unit);
    }
};

export const renderStickerCompositeWithAnnotations = async (
    unit: Unit,
    annotationsOverride: StickerAnnotation[],
    options?: {
        includeRasterizedAnnotationLayer?: boolean;
    },
): Promise<string> => {
    const baseSrc =
        unit.data.rasterizedAnnotationLayerSrc
            ? unit.data.src
            : unit.data.previewSrc || unit.data.src;
    if (!baseSrc) {
        throw new Error("Sticker has no image source");
    }

    const image = await loadImage(baseSrc);
    const cropRect = unit.data.imageEditState?.cropRect;
    const sourceSize = unit.data.imageEditState?.sourceSize || { w: image.width, h: image.height };
    const renderWidth = Math.max(1, Math.round(unit.w));
    const renderHeight = Math.max(1, Math.round(unit.h));

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
            0,
            0,
            renderWidth,
            renderHeight,
        );
    } else {
        context.drawImage(image, 0, 0, renderWidth, renderHeight);
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
    );

    if (radius > 0) {
        context.restore();
    }

    return canvas.toDataURL("image/png");
};

export const renderStickerComposite = async (unit: Unit): Promise<string> => {
    const composite = await renderStickerCompositeWithAnnotations(
        unit,
        unit.data.annotationState?.elements || [],
    );
    return applyBeautify(composite, unit);
};

/**
 * If beautify is enabled for the unit, place the composite onto a larger
 * background canvas with padding, rounded corners and an optional drop shadow.
 * Otherwise returns the composite unchanged. Applied only at export time
 * (save/copy), never to the on-canvas unit.
 */
const applyBeautify = async (compositeSrc: string, unit: Unit): Promise<string> => {
    const beautify = unit.data.imageEditState?.beautify;
    if (!beautify?.enabled) return compositeSrc;

    const inner = await loadImage(compositeSrc);
    const layout = computeBeautifyLayout(inner.width, inner.height, beautify.padding);

    const canvas = document.createElement("canvas");
    canvas.width = layout.outerWidth;
    canvas.height = layout.outerHeight;
    const context = canvas.getContext("2d");
    if (!context) return compositeSrc;

    paintBeautifyBackground(
        context,
        resolveBeautifyBackground(beautify.backgroundId),
        layout.outerWidth,
        layout.outerHeight,
    );

    const radius = Math.max(0, Math.min(beautify.cornerRadius, layout.innerWidth / 2, layout.innerHeight / 2));

    context.save();
    if (beautify.shadow) {
        context.shadowColor = "rgba(0, 0, 0, 0.35)";
        context.shadowBlur = Math.max(8, Math.round(beautify.padding / 2));
        context.shadowOffsetY = Math.max(4, Math.round(beautify.padding / 4));
    }
    // Clip to a rounded rect so the shadow follows the rounded corners.
    context.beginPath();
    context.roundRect(layout.innerX, layout.innerY, layout.innerWidth, layout.innerHeight, radius);
    context.closePath();
    // Paint an opaque backing so the shadow renders even if the inner image
    // has transparent regions, then clip and draw the composite.
    context.fillStyle = "#ffffff";
    context.fill();
    context.restore();

    context.save();
    context.beginPath();
    context.roundRect(layout.innerX, layout.innerY, layout.innerWidth, layout.innerHeight, radius);
    context.clip();
    context.drawImage(inner, layout.innerX, layout.innerY, layout.innerWidth, layout.innerHeight);
    context.restore();

    return canvas.toDataURL("image/png");
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
        unit.data.rasterizedAnnotationLayerSrc
            ? unit.data.src
            : unit.data.previewSrc || unit.data.src;
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
    const renderWidth = Math.max(1, Math.round(unit.w));
    const renderHeight = Math.max(1, Math.round(unit.h));
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
