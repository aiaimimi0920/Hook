/** Ordered annotation compositing with one non-compounding highlighter wash. */
import type { StickerAnnotation, StickerLineAnnotation } from "../types/stickerEditing";
import type { Unit } from "../types/unit";
import { drawStrokePath } from "./stickerCanvas";
import {
    annotationRenderRank,
    drawAnnotation,
} from "./stickerAnnotationDrawing";
import { HIGHLIGHTER_LAYER_OPACITY } from "./stickerEditing";

export const drawAnnotationsWithHighlighterLayer = (
    context: CanvasRenderingContext2D,
    annotations: StickerAnnotation[],
    sourceImage: HTMLImageElement,
    unit: Unit,
    layerWidth: number,
    layerHeight: number,
    coordinateScale: { x: number; y: number } = { x: 1, y: 1 },
) => {
    const sorted = [...annotations].sort(
        (a, b) => annotationRenderRank(a.type) - annotationRenderRank(b.type) || a.zIndex - b.zIndex,
    );
    const highlighters = sorted.filter(
        (annotation): annotation is StickerLineAnnotation => annotation.type === "highlighter",
    );

    // Draw every highlighter at full opacity, then blit the layer once so
    // overlaps never compound alpha and live/export behavior stays aligned.
    if (highlighters.length > 0 && layerWidth > 0 && layerHeight > 0) {
        const layer = document.createElement("canvas");
        layer.width = Math.max(1, Math.round(layerWidth * coordinateScale.x));
        layer.height = Math.max(1, Math.round(layerHeight * coordinateScale.y));
        const layerContext = layer.getContext("2d");
        if (layerContext) {
            if (coordinateScale.x !== 1 || coordinateScale.y !== 1) {
                layerContext.scale(coordinateScale.x, coordinateScale.y);
            }
            for (const highlighter of highlighters) {
                drawStrokePath(layerContext, highlighter.points, {
                    color: highlighter.style.color,
                    width: highlighter.style.width,
                    opacity: 1,
                });
            }
            context.save();
            context.globalAlpha = HIGHLIGHTER_LAYER_OPACITY;
            if (coordinateScale.x !== 1 || coordinateScale.y !== 1) {
                // The caller may already scale the destination context to source
                // pixels. Cancel that transform while blitting the high-resolution
                // layer so it is not downsampled and enlarged a second time.
                context.scale(1 / coordinateScale.x, 1 / coordinateScale.y);
                context.drawImage(layer, 0, 0, layer.width, layer.height);
            } else {
                context.drawImage(layer, 0, 0, layerWidth, layerHeight);
            }
            context.restore();
        }
    }

    for (const annotation of sorted) {
        if (annotation.type === "highlighter") continue;
        drawAnnotation(context, annotation, sourceImage, unit);
    }
};
