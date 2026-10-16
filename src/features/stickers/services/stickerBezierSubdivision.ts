import type { StickerPoint } from "../types/stickerEditing";
import { evaluateBezier, isCubicBezier, MAX_BEZIER_SEGMENTS } from "./stickerBezierGeometry";

/** Keep the surviving anchors' tangents; removing an interior anchor merges two cubics. */
export const deleteBezierAnchor = (points: readonly StickerPoint[], index: number): StickerPoint[] => {
    const clone = (value: readonly StickerPoint[]) => value.map((point) => ({ ...point }));
    if (!isCubicBezier(points) || points.length <= 4 || !Number.isInteger(index)
        || index < 0 || index >= points.length || index % 3 !== 0) return clone(points);
    if (index === 0) return clone(points.slice(3));
    if (index === points.length - 1) return clone(points.slice(0, -3));
    return clone([...points.slice(0, index - 1), ...points.slice(index + 2)]);
};

const interpolate = (a: StickerPoint, b: StickerPoint, t: number): StickerPoint => ({
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
});

/** De Casteljau subdivision inserts an anchor without changing the existing path. */
export const splitBezierSegment = (points: readonly StickerPoint[], segment: number, t: number): StickerPoint[] => {
    if (!isCubicBezier(points) || points.length >= MAX_BEZIER_SEGMENTS * 3 + 1
        || !Number.isInteger(segment) || segment < 0 || segment * 3 + 3 >= points.length
        || !Number.isFinite(t) || t <= 0 || t >= 1) return points.map((p) => ({ ...p }));
    const index = segment * 3;
    const [p0, p1, p2, p3] = points.slice(index, index + 4);
    const a = interpolate(p0, p1, t), b = interpolate(p1, p2, t), c = interpolate(p2, p3, t);
    const d = interpolate(a, b, t), e = interpolate(b, c, t), anchor = interpolate(d, e, t);
    return [...points.slice(0, index + 1), a, d, anchor, e, c, ...points.slice(index + 3)].map((p) => ({ ...p }));
};

/** Bounded closest-point search is only used for a double-click, never pointer-move. */
export const insertBezierAnchor = (points: readonly StickerPoint[], point: StickerPoint): StickerPoint[] => {
    if (!isCubicBezier(points) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return points.map((p) => ({ ...p }));
    let best = { segment: 0, t: 0, distance: Infinity };
    for (let segment = 0; segment < (points.length - 1) / 3; segment += 1) {
        const cubic = points.slice(segment * 3, segment * 3 + 4);
        const distance = (t: number) => {
            const p = evaluateBezier(cubic, t);
            return (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
        };
        let sample = 0;
        for (let i = 1; i <= 64; i += 1) if (distance(i / 64) < distance(sample / 64)) sample = i;
        let low = Math.max(0, (sample - 1) / 64), high = Math.min(1, (sample + 1) / 64);
        for (let i = 0; i < 24; i += 1) {
            const a = low + (high - low) / 3, b = high - (high - low) / 3;
            if (distance(a) < distance(b)) high = b; else low = a;
        }
        const t = (low + high) / 2;
        if (distance(t) < best.distance) best = { segment, t, distance: distance(t) };
    }
    if (best.t < 0.01 || best.t > 0.99) return points.map((p) => ({ ...p }));
    return splitBezierSegment(points, best.segment, best.t);
};
