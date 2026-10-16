import type { StickerLineAnnotation } from "../types/stickerEditing";
import { getBezierRenderGeometry, isCubicBezier } from "./stickerBezierGeometry";
import { applyLineDash } from "./stickerCanvas";

/** Canvas export uses the same shaft/head geometry as the live SVG. */
export const drawBezierAnnotation = (context: CanvasRenderingContext2D, line: StickerLineAnnotation) => {
    if (!isCubicBezier(line.points) || line.style.width <= 0) return;
    const { shaft, head } = getBezierRenderGeometry(line.points, line.style.width, line.showArrowHead);
    context.save();
    context.globalAlpha = line.style.opacity ?? 1;
    context.strokeStyle = line.style.color;
    context.fillStyle = line.style.color;
    context.lineWidth = line.style.width;
    context.lineCap = line.style.dashPattern && line.style.dashPattern !== "solid" ? "butt" : "round";
    context.lineJoin = "round";
    applyLineDash(context, line.style.dashPattern, line.style.width);
    context.beginPath();
    context.moveTo(line.points[0].x, line.points[0].y);
    if (head) {
        for (const point of shaft.slice(1)) context.lineTo(point.x, point.y);
    } else {
        for (let i = 1; i < line.points.length; i += 3) {
            const [c1, c2, end] = line.points.slice(i, i + 3);
            context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
        }
    }
    context.stroke();
    if (head) {
        context.beginPath();
        context.moveTo(head[0].x, head[0].y);
        for (const point of head.slice(1)) context.lineTo(point.x, point.y);
        context.closePath();
        context.fill();
    }
    context.restore();
};
