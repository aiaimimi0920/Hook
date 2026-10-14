import { describe, expect, it, vi } from "vitest";
import { createBezierPoints, evaluateBezier, getBezierRenderGeometry, sampleBezier } from "../../src/services/stickerBezierGeometry";
import { annotationContainsPoint, getAnnotationBounds, moveLineEndpoint, translateAnnotation, rotateAnnotationAroundCenter, scaleAnnotationAroundCenter } from "../../src/services/stickerGeometry";
import { drawBezierAnnotation } from "../../src/services/stickerBezierDrawing";
import { applyStickerToolSettingsPatch } from "../../src/services/toolSettings";
import { createDefaultStickerToolSettings } from "../../src/services/stickerEditing";
import type { StickerLineAnnotation } from "../../src/types/stickerEditing";

const curve = (): StickerLineAnnotation => ({
    id: "curve", type: "bezier", zIndex: 1,
    points: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }],
    style: { color: "#ef4444", width: 3, dashPattern: "solid" },
});

describe("editable cubic geometry", () => {
    it("creates four independent control points and evaluates a true cubic", () => {
        const start = { x: 10, y: 20 };
        const points = createBezierPoints(start, { x: 310, y: 20 });
        expect(points).toHaveLength(4);
        expect(points[1].y).toBeGreaterThan(start.y);
        expect(evaluateBezier(curve().points, 0.5)).toEqual({ x: 50, y: 75 });
        expect(getBezierRenderGeometry(curve().points, 3).path).toContain(" C ");
        points[0].x = 90;
        expect(start.x).toBe(10);
    });

    it("hits the rendered curve, not its control polygon, with bounded subdivision", () => {
        const line = curve();
        expect(annotationContainsPoint(line, { x: 50, y: 75 }, 1)).toBe(true);
        expect(annotationContainsPoint(line, { x: 50, y: 100 }, 1)).toBe(false);
        expect(getAnnotationBounds(line).h).toBeLessThan(80);
        const extreme = line.points.map((p) => ({ x: p.x * 1e6, y: p.y * 1e6 }));
        expect(sampleBezier(extreme).length).toBeLessThanOrEqual(513);
        expect(sampleBezier([{ x: NaN, y: 0 }])).toEqual([]);
        const loop = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: -200, y: 0 }, { x: 0, y: 0 }];
        expect(sampleBezier(loop).some((p) => p.x > 50)).toBe(true);
    });

    it("edits each tangent independently and carries the tangent when moving an endpoint", () => {
        const line = curve();
        const edited = moveLineEndpoint(line, "control1", { x: 25, y: 150 });
        expect(edited.points[1]).toEqual({ x: 25, y: 150 });
        expect(edited.points[2]).toEqual(line.points[2]);
        expect(line.points[1]).toEqual({ x: 0, y: 100 });
        const moved = moveLineEndpoint(line, "start", { x: 20, y: 30 });
        expect(moved.points[1]).toEqual({ x: 20, y: 130 });
        expect(moved.points[3]).toEqual(line.points[3]);
    });

    it("preserves control points through translation, rotation, scaling and JSON roundtrip", () => {
        const line = curve();
        expect(translateAnnotation(line, 10, 20).points[2]).toEqual({ x: 110, y: 120 });
        for (const transformed of [rotateAnnotationAroundCenter(line, 45), scaleAnnotationAroundCenter(line, { x: 2, y: 0.5 })]) {
            expect(transformed.type).toBe("bezier");
            expect("points" in transformed && transformed.points?.length).toBe(4);
            expect(JSON.parse(JSON.stringify(transformed))).toEqual(transformed);
        }
    });

    it("exports a native cubic, while arrow exports share the live shaft/head", () => {
        const context = {
            save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
            bezierCurveTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(), closePath: vi.fn(), setLineDash: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
        const line = curve();
        drawBezierAnnotation(context, line);
        expect(context.bezierCurveTo).toHaveBeenCalledWith(0, 100, 100, 100, 100, 0);
        expect(context.fill).not.toHaveBeenCalled();
        line.showArrowHead = true;
        line.style.dashPattern = "dash-1";
        const geometry = getBezierRenderGeometry(line.points, 3, true);
        const base = { x: (geometry.head![1].x + geometry.head![2].x) / 2, y: (geometry.head![1].y + geometry.head![2].y) / 2 };
        expect(Math.hypot(base.x - 100, base.y)).toBeCloseTo(24);
        expect(base.x).toBeCloseTo(100);
        drawBezierAnnotation(context, line);
        expect(context.setLineDash).toHaveBeenLastCalledWith([8, 4]);
        expect(context.fill).toHaveBeenCalledOnce();
        expect(context.moveTo).toHaveBeenLastCalledWith(geometry.head![0].x, geometry.head![0].y);
        expect(geometry.shaft.at(-1)).not.toEqual(line.points[3]);
    });

    it("keeps curve width, dash and arrow preferences independent of straight lines", () => {
        let settings = applyStickerToolSettingsPatch(createDefaultStickerToolSettings(), { activeTool: "bezier" });
        settings = applyStickerToolSettingsPatch(settings, { strokeWidth: 19, lineArrowEnabled: true, shapeStrokeDashPattern: "dash-2" });
        settings = applyStickerToolSettingsPatch(settings, { activeTool: "line" });
        expect(settings.strokeWidth).toBe(3);
        expect(settings.lineArrowEnabled).toBe(false);
        settings = applyStickerToolSettingsPatch(settings, { activeTool: "bezier" });
        expect(settings.strokeWidth).toBe(19);
        expect(settings.lineArrowEnabled).toBe(true);
        expect(settings.shapeStrokeDashPattern).toBe("dash-2");
    });
});
