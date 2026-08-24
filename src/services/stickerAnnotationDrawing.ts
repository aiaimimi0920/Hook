/** Per-annotation canvas drawing and effect masking for sticker exports. */
import type {
    StickerAnnotation,
    StickerEffectAnnotation,
    StickerLineAnnotation,
    StickerPoint,
    StickerShapeAnnotation,
    StickerTextAnnotation,
} from "../types/stickerEditing";
import type { Unit } from "../types/unit";
import {
    applyLineDash,
    drawStrokePath,
    resolveFiniteCanvasDimension,
} from "./stickerCanvas";
import {
    BLUR_EFFECT_OVERLAY_FILL,
    computeEffectSourceProjection,
    paintMosaicGrid,
    renderBlurToCanvas,
} from "./stickerEffects";
import {
    buildSerialAnnotationMetrics,
    isTransparentStickerColor,
} from "./stickerEditing";
import {
    buildPolygonPoints,
    buildTrianglePoints,
    getAnnotationCenter,
    traceRoundedPolygonPath,
} from "./stickerGeometry";

// Blur sits below mosaic so it cannot paint over the same censored pixels.
export const annotationRenderRank = (type: string) =>
    type === "blur" ? 0 : type === "mosaic" ? 1 : 2;

export const eraseStrokePathToTransparency = (
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

export const drawAnnotation = (
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
            context.textBaseline = annotation.type === "serial" ? "middle" : "alphabetic";
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
            // Render the effect over its bounding box, then keep only its brush
            // stroke through a destination-in mask before compositing it back.
            const boxW = resolveFiniteCanvasDimension(Math.ceil(effect.w), "effect width");
            const boxH = resolveFiniteCanvasDimension(Math.ceil(effect.h), "effect height");
            const points = effect.points ?? [];
            const brushWidth = Math.max(1, effect.brushWidth ?? effect.style.width ?? 12);

            const layer = document.createElement("canvas");
            layer.width = boxW;
            layer.height = boxH;
            const layerContext = layer.getContext("2d");
            if (!layerContext) {
                return;
            }

            const projection = computeEffectSourceProjection(
                { x: effect.x, y: effect.y, w: effect.w, h: effect.h },
                { w: unit.w, h: unit.h },
                { w: sourceImage.width, h: sourceImage.height },
                unit.data.imageEditState,
            );

            const traceStrokePath = () => {
                layerContext.beginPath();
                if (points.length === 1) {
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
                // Absolute-position colors keep the censor grid non-repeating and
                // never sample the underlying image.
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
