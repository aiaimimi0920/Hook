/** Cubic control points remain the source of truth; flattening is bounded and render-only. */
import type { StickerPoint } from "../types/stickerEditing";
import { buildArrowHeadPolygon } from "./stickerArrowGeometry";
import type { LineEndpointHandle } from "./stickerGeometryTypes";

export const MAX_BEZIER_SEGMENTS = 64;
export const isCubicBezier = (points: readonly StickerPoint[]) =>
    points.length >= 4 && points.length <= MAX_BEZIER_SEGMENTS * 3 + 1 && (points.length - 1) % 3 === 0
    && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

export const createBezierPoints = (start: StickerPoint, end: StickerPoint): StickerPoint[] => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return [
        { ...start },
        { x: start.x + dx / 3 - dy / 4, y: start.y + dy / 3 + dx / 4 },
        { x: start.x + dx * 2 / 3 - dy / 4, y: start.y + dy * 2 / 3 + dx / 4 },
        { ...end },
    ];
};

export const evaluateBezier = (points: readonly StickerPoint[], t: number): StickerPoint => {
    const u = 1 - t;
    return {
        x: u ** 3 * points[0].x + 3 * u * u * t * points[1].x + 3 * u * t * t * points[2].x + t ** 3 * points[3].x,
        y: u ** 3 * points[0].y + 3 * u * u * t * points[1].y + 3 * u * t * t * points[2].y + t ** 3 * points[3].y,
    };
};

const midpoint = (a: StickerPoint, b: StickerPoint): StickerPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const sampleBezier = (points: readonly StickerPoint[]): StickerPoint[] => {
    if (!isCubicBezier(points)) return [];
    const result: StickerPoint[] = [{ ...points[0] }];
    const maxDepth = Math.min(9, Math.floor(Math.log2(4096 / ((points.length - 1) / 3))));
    const subdivide = (p: readonly StickerPoint[], depth: number) => {
        // Control-to-chord distances alone miss collinear reversals. Second differences
        // bound curvature even for cusps/loops; depth caps pathological imported data.
        const curvature = Math.max(
            Math.hypot(p[0].x - 2 * p[1].x + p[2].x, p[0].y - 2 * p[1].y + p[2].y),
            Math.hypot(p[1].x - 2 * p[2].x + p[3].x, p[1].y - 2 * p[2].y + p[3].y),
        );
        if (depth === maxDepth || curvature <= 0.25) {
            result.push({ ...p[3] });
            return;
        }
        const a = midpoint(p[0], p[1]);
        const b = midpoint(p[1], p[2]);
        const c = midpoint(p[2], p[3]);
        const d = midpoint(a, b);
        const e = midpoint(b, c);
        const f = midpoint(d, e);
        subdivide([p[0], a, d, f], depth + 1);
        subdivide([f, e, c, p[3]], depth + 1);
    };
    for (let index = 0; index < points.length - 1; index += 3) subdivide(points.slice(index, index + 4), 0);
    return result;
};

export const bezierPath = (points: readonly StickerPoint[]) => {
    if (!isCubicBezier(points)) return "";
    const commands = [`M ${points[0].x} ${points[0].y}`];
    for (let i = 1; i < points.length; i += 3) commands.push(`C ${points[i].x} ${points[i].y} ${points[i + 1].x} ${points[i + 1].y} ${points[i + 2].x} ${points[i + 2].y}`);
    return commands.join(" ");
};

export const getBezierRenderGeometry = (points: readonly StickerPoint[], width: number, arrow = false) => {
    const samples = sampleBezier(points);
    let head: StickerPoint[] | null = null;
    let shaft = samples;
    if (arrow && width > 0 && samples.length > 1) {
        const end = points[points.length - 1];
        const tangent = points.slice(0, -1).reverse().find((p) => Math.hypot(end.x - p.x, end.y - p.y) > 0.001);
        const lengths = samples.slice(1).map((p, i) => Math.hypot(p.x - samples[i].x, p.y - samples[i].y));
        const requestedLength = Math.max(24, width * 6);
        const headLength = Math.min(requestedLength, lengths.reduce((a, b) => a + b, 0) / 2);
        if (tangent && headLength > 0) {
            const distance = Math.hypot(end.x - tangent.x, end.y - tangent.y);
            const base = { x: end.x - (end.x - tangent.x) / distance * headLength, y: end.y - (end.y - tangent.y) / distance * headLength };
            head = buildArrowHeadPolygon([base, end], {
                headLength, headWidth: Math.max(16, width * 5) * headLength / requestedLength, minDistance: 0,
            });
            // Trim by arc length, not the last subdivision segment (which would
            // shrink the head whenever a curve is sampled more densely).
            let trim = 0;
            let index = samples.length - 1;
            while (index > 0 && trim < headLength) { trim += lengths[index - 1]; index -= 1; }
            shaft = [...samples.slice(0, index + 1), base];
        }
    }
    return {
        samples, shaft, head,
        path: head
            ? shaft.map((p, index) => `${index ? "L" : "M"} ${p.x} ${p.y}`).join(" ")
            : bezierPath(points),
    };
};

export const bezierHandles = (points: readonly StickerPoint[]): { handle: LineEndpointHandle; point: StickerPoint }[] => isCubicBezier(points)
    ? points.map((point, index) => ({ point, handle: index === 0 ? "start" : index === points.length - 1 ? "end"
        : index === 1 ? "control1" : index === 2 ? "control2" : index % 3 === 0 ? `node:${index}` : `control:${index}` })) : [];

export const bezierExtensionHandles = (points: readonly StickerPoint[]): { handle: LineEndpointHandle; point: StickerPoint }[] => {
    if (!isCubicBezier(points) || points.length >= MAX_BEZIER_SEGMENTS * 3 + 1) return [];
    return (["start", "end"] as const).map((side) => {
        const anchor = side === "start" ? points[0] : points[points.length - 1];
        const tangent = side === "start" ? points[1] : points[points.length - 2];
        const length = Math.hypot(anchor.x - tangent.x, anchor.y - tangent.y);
        return { handle: `extend-${side}` as const, point: { x: anchor.x + (length ? (anchor.x - tangent.x) / length : side === "start" ? -1 : 1) * 28,
            y: anchor.y + (length ? (anchor.y - tangent.y) / length : 0) * 28 } };
    });
};

export const bezierGuidePath = (points: readonly StickerPoint[]) => {
    if (!isCubicBezier(points)) return "";
    const lines: string[] = [];
    for (let i = 0; i < points.length - 1; i += 3) lines.push(`M ${points[i].x} ${points[i].y} L ${points[i + 1].x} ${points[i + 1].y} M ${points[i + 2].x} ${points[i + 2].y} L ${points[i + 3].x} ${points[i + 3].y}`);
    return lines.join(" ");
};

export const hitBezierHandle = (points: readonly StickerPoint[], point: StickerPoint) =>
    [...bezierHandles(points), ...bezierExtensionHandles(points)].find((candidate) => Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y) <= 10)?.handle;

export const extendBezier = (points: readonly StickerPoint[], end: StickerPoint, fromStart = false): StickerPoint[] => {
    if (!isCubicBezier(points) || points.length >= MAX_BEZIER_SEGMENTS * 3 + 1) return points.map((p) => ({ ...p }));
    if (fromStart) return extendBezier([...points].reverse(), end).reverse();
    const start = points[points.length - 1], previous = points[points.length - 2];
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy) / 3;
    const tangentLength = Math.hypot(start.x - previous.x, start.y - previous.y);
    const c1 = tangentLength > 0.001 ? { x: start.x + (start.x - previous.x) / tangentLength * length,
        y: start.y + (start.y - previous.y) / tangentLength * length } : { x: start.x + dx / 3, y: start.y + dy / 3 };
    return [...points.map((p) => ({ ...p })), c1, { x: end.x - dx / 3, y: end.y - dy / 3 }, { ...end }];
};

export const moveBezierHandle = (
    points: readonly StickerPoint[], handle: LineEndpointHandle, point: StickerPoint,
): StickerPoint[] => {
    if (!isCubicBezier(points) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return points.map((p) => ({ ...p }));
    if (handle === "extend-start" || handle === "extend-end") return extendBezier(points, point, handle === "extend-start");
    const index = handle === "start" ? 0 : handle === "end" ? points.length - 1 : handle === "control1" ? 1
        : handle === "control2" ? 2 : Number(handle.split(":")[1]);
    if (!Number.isInteger(index) || index < 0 || index >= points.length) return points.map((p) => ({ ...p }));
    const next = points.map((p) => ({ ...p }));
    // Moving an endpoint carries its tangent handle, preserving the local bend.
    if (index % 3 === 0) {
        for (const adjacent of [index - 1, index + 1]) {
            if (!next[adjacent]) continue;
            next[adjacent].x += point.x - points[index].x;
            next[adjacent].y += point.y - points[index].y;
        }
    }
    next[index] = { ...point };
    return next;
};
