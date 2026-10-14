import { describe, expect, it, vi } from "vitest";
import { bezierHandles, bezierPath, createBezierPoints, evaluateBezier, extendBezier, getBezierRenderGeometry, isCubicBezier, MAX_BEZIER_SEGMENTS, moveBezierHandle, sampleBezier } from "../../src/services/stickerBezierGeometry";
import { deleteBezierAnchor, insertBezierAnchor, splitBezierSegment } from "../../src/services/stickerBezierSubdivision";
import { drawBezierAnnotation } from "../../src/services/stickerBezierDrawing";

const points = () => createBezierPoints({ x: 20, y: 80 }, { x: 260, y: 80 });
describe("multi-segment cubic paths", () => {
    it("deletes interior anchors while keeping neighboring anchors and outer tangents", () => {
        const path = extendBezier(extendBezier(points(), { x: 400, y: 180 }), { x: 520, y: 80 });
        const shortened = deleteBezierAnchor(path, 3);
        expect(shortened).toEqual([path[0], path[1], ...path.slice(5)]);
        expect(isCubicBezier(shortened)).toBe(true);
        expect(path).toHaveLength(10);
        expect(shortened[0]).not.toBe(path[0]);
    });
    it("removes just the first or last segment when deleting an endpoint", () => {
        const path = extendBezier(points(), { x: 400, y: 180 });
        expect(deleteBezierAnchor(path, 0)).toEqual(path.slice(3));
        expect(deleteBezierAnchor(path, 6)).toEqual(points());
        for (const index of [-3, 1, 2, 1.5, 9, NaN, Infinity]) expect(deleteBezierAnchor(path, index)).toEqual(path);
        expect(deleteBezierAnchor(points(), 0)).toEqual(points());
        expect(deleteBezierAnchor(points(), 3)).toEqual(points());
        expect(deleteBezierAnchor([], 0)).toEqual([]);
    });
    it("subdivides without changing any point on the rendered curve", () => {
        const original = points(), split = splitBezierSegment(original, 0, 0.4);
        expect(split).toHaveLength(7);
        for (let i = 0; i <= 100; i += 1) {
            const t = i / 100, expected = evaluateBezier(original, t);
            const actual = t <= 0.4 ? evaluateBezier(split.slice(0, 4), t / 0.4) : evaluateBezier(split.slice(3), (t - 0.4) / 0.6);
            expect(actual.x).toBeCloseTo(expected.x, 8);
            expect(actual.y).toBeCloseTo(expected.y, 8);
        }
        expect(insertBezierAnchor(original, evaluateBezier(original, 0.5))[3].x).toBeCloseTo(140, 2);
        expect(original).toHaveLength(4);
    });
    it("extends either endpoint without changing the original segments", () => {
        const original = points();
        const appended = extendBezier(original, { x: 400, y: 200 });
        expect(appended.slice(0, 4)).toEqual(original);
        expect(appended.at(-1)).toEqual({ x: 400, y: 200 });
        const dx = original[3].x - original[2].x, dy = original[3].y - original[2].y;
        expect(dx * (appended[4].y - original[3].y) - dy * (appended[4].x - original[3].x)).toBeCloseTo(0);
        expect(extendBezier(original, { x: -100, y: 150 }, true).slice(3)).toEqual(original);
    });
    it("moves an interior anchor with both adjacent tangent handles", () => {
        const path = splitBezierSegment(points(), 0, 0.5);
        const moved = moveBezierHandle(path, "node:3", { x: path[3].x + 10, y: path[3].y + 20 });
        for (const i of [2, 3, 4]) expect(moved[i]).toEqual({ x: path[i].x + 10, y: path[i].y + 20 });
        expect(moved[1]).toEqual(path[1]);
        const control = moveBezierHandle(moved, "control:4", { x: 200, y: 50 });
        expect(control[4]).toEqual({ x: 200, y: 50 });
        expect(control[3]).toEqual(moved[3]);
        expect(bezierHandles(path).map((h) => h.handle)).toContain("node:3");
    });
    it("renders every segment and attaches the arrow to the final endpoint", () => {
        const path = extendBezier(points(), { x: 420, y: 200 });
        expect(bezierPath(path).match(/ C /g)).toHaveLength(2);
        expect(getBezierRenderGeometry(path, 3, true).head![0]).toEqual(path.at(-1));
        const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), bezierCurveTo: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn() } as unknown as CanvasRenderingContext2D;
        drawBezierAnnotation(context, { id: "p", type: "bezier", zIndex: 1, points: path, style: { color: "#fff", width: 3 } });
        expect(context.bezierCurveTo).toHaveBeenCalledTimes(2);
    });
    it("bounds path growth and work for imported or repeated additions", () => {
        let path = points();
        for (let i = 1; i < MAX_BEZIER_SEGMENTS; i += 1) path = extendBezier(path, { x: i * 1000, y: i % 2 * 10000 });
        expect(path).toHaveLength(193);
        expect(extendBezier(path, { x: 9999, y: 333 })).toEqual(path);
        expect(splitBezierSegment(path, 0, 0.5)).toEqual(path);
        expect(sampleBezier(path).length).toBeLessThanOrEqual(4097);
        expect(isCubicBezier([...path, { x: 0, y: 0 }])).toBe(false);
    });
});
