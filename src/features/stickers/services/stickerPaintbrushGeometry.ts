import type { StickerPoint, StickerStrokeStyle } from "../types/stickerEditing";
import { getStickerColorAlpha } from "./stickerStyleValues";
import { brushWeight } from "./stickerBrushDynamics";
import { brushCoordinate as coordinate, reduceBrushSamples } from "./stickerBrushSampleReduction";

export const MAX_FREEHAND_POINTS = 2048;
const clamp = (n: number, fallback: number, min: number, max: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
export const freehandOpacity = (value: number) => clamp(value, 1, 0, 1);
export const freehandSmoothing = (value: number) => clamp(value, 0, 0, 100);

/** Pencil retains its legacy cap. Brush history must not be halved while drawing;
 * its user-authored geometry is rendered in stable bounded chunks instead. */
export const appendFreehandPoint = (points: StickerPoint[], point: StickerPoint, preserveHistory = false) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return points;
    const last = points.at(-1);
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.75) return points;
    const base = !preserveHistory && points.length >= MAX_FREEHAND_POINTS ? points.filter((_, i) => i % 2 === 0) : points;
    return [...base, point];
};

/** Bake smoothing into stored centers, so selection and transforms use the visible path. */
export const smoothFreehandPoints = (input: readonly StickerPoint[], smoothing: number, preserveHistory = false): StickerPoint[] => {
    const stride = preserveHistory ? 1 : Math.max(1, Math.ceil(input.length / MAX_FREEHAND_POINTS));
    const points: StickerPoint[] = [];
    for (let i = 0; i < input.length; i += stride) {
        const p = input[i];
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) points.push({ x: clamp(p.x, 0, -100000, 100000), y: clamp(p.y, 0, -100000, 100000) });
    }
    const last = input.at(-1);
    if (stride > 1 && last && Number.isFinite(last.x) && Number.isFinite(last.y)) points[points.length - 1] = { x: clamp(last.x, 0, -100000, 100000), y: clamp(last.y, 0, -100000, 100000) };
    const strength = freehandSmoothing(smoothing) / 100;
    if (!strength || points.length < 3) return points;
    for (let pass = 0; pass < 3; pass += 1) {
        const previous = points.map((p) => ({ ...p }));
        for (let i = 1; i < points.length - 1; i += 1) points[i] = {
            x: previous[i].x * (1 - strength / 2) + (previous[i - 1].x + previous[i + 1].x) * strength / 4,
            y: previous[i].y * (1 - strength / 2) + (previous[i - 1].y + previous[i + 1].y) * strength / 4,
        };
    }
    return points;
};

export const paintbrushSamples = (input: readonly StickerPoint[], width: number, weights?: readonly number[]) => {
    const points = smoothFreehandPoints(input, 0, true);
    const radius = clamp(width, 16, 1, 999) / 2;
    const distances = [0];
    for (let i = 1; i < points.length; i += 1) distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    const total = distances.at(-1) ?? 0;
    const taper = Math.min(total * 0.28, Math.max(10, radius * 2.5));
    if (total < 1) return points.slice(0, 1).map((point) => ({ ...point, radius }));
    const samples: (StickerPoint & { radius: number })[] = [];
    const sample = (segment: number, t: number) => {
        const distance = distances[segment - 1] + t * (distances[segment] - distances[segment - 1]);
        const a = points[segment - 1], b = points[segment];
        const weight = weights?.length === points.length
            ? brushWeight(weights[segment - 1]) * (1 - t) + brushWeight(weights[segment]) * t : 0.85;
        const start = 0.8 + 0.2 * Math.min(1, distance / Math.max(1, taper * 0.45));
        const remaining = Math.min(1, (total - distance) / Math.max(1, taper));
        const finish = 0.08 + 0.92 * remaining * remaining * (3 - 2 * remaining);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
            radius: radius * weight * Math.min(start, finish) };
    };
    samples.push(sample(1, 0));
    for (let segment = 1; segment < points.length; segment++) {
        // Original vertices never move when the stroke grows. Only subdivide the
        // short entry/exit regions to describe their curved radius envelope.
        const nearTip = distances[segment - 1] < taper || distances[segment] > total - taper;
        const divisions = nearTip ? 8 : 1;
        for (let step = 1; step <= divisions; step++) samples.push(sample(segment, step / divisions));
    }
    return samples;
};

const ribbonQuad = (a: StickerPoint & { radius: number }, b: StickerPoint & { radius: number }) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    return [{ x: a.x - nx * a.radius, y: a.y - ny * a.radius }, { x: b.x - nx * b.radius, y: b.y - ny * b.radius },
        { x: b.x + nx * b.radius, y: b.y + ny * b.radius }, { x: a.x + nx * a.radius, y: a.y + ny * a.radius }];
};

/** Disks and ribbons share winding and are filled once: translucent overlaps stay uniform. */
export const samplesPath = (samples: ReturnType<typeof paintbrushSamples>, connectFrom?: StickerPoint & { radius: number }) => {
    return samples.map((p, i) => {
        const r = coordinate(p.radius);
        const disk = `M ${coordinate(p.x + p.radius)} ${coordinate(p.y)} a ${r} ${r} 0 1 1 ${coordinate(-2 * p.radius)} 0 a ${r} ${r} 0 1 1 ${coordinate(2 * p.radius)} 0 Z`;
        const previous = i ? samples[i - 1] : connectFrom;
        return disk + (previous ? ribbonQuad(previous, p).map((q, j) => `${j ? "L" : "M"} ${coordinate(q.x)} ${coordinate(q.y)}`).join(" ") + " Z" : "");
    }).join(" ");
};

export const paintbrushPath = (points: readonly StickerPoint[], width: number, weights?: readonly number[]) => samplesPath(reduceBrushSamples(paintbrushSamples(points, width, weights)));

/** Fixed-cost radial bands: source-over alpha is compensated so the center honors
 * both color alpha and the opacity control, without darkening self-intersections. */
export const paintbrushLayers = (points: readonly StickerPoint[], style: StickerStrokeStyle) => {
    const samples = reduceBrushSamples(paintbrushSamples(points, style.width, style.brushWeights));
    const colorAlpha = getStickerColorAlpha(style.color);
    const peak = colorAlpha * freehandOpacity(style.opacity ?? 1);
    let previous = 0;
    return Array.from({ length: 4 }, (_, i) => {
        const t = (i + 1) / 4;
        const target = peak * t * t * (3 - 2 * t);
        const opacity = colorAlpha && previous < 1 ? (target - previous) / ((1 - previous) * colorAlpha) : 0;
        previous = target;
        const scaled = samples.map((p) => ({ ...p, radius: p.radius * (1 - i * 0.12 / 3) }));
        return { samples: scaled, opacity };
    });
};

export const paintbrushRenderPaths = (points: readonly StickerPoint[], style: StickerStrokeStyle) =>
    paintbrushLayers(points, style).map((layer) => ({ path: samplesPath(layer.samples), opacity: layer.opacity }));

export const drawPaintbrush = (context: CanvasRenderingContext2D, points: readonly StickerPoint[], style: StickerStrokeStyle) => {
    context.save();
    context.fillStyle = style.color;
    for (const { samples, opacity } of paintbrushLayers(points, style)) {
        context.beginPath();
        samples.forEach((p, i) => {
            context.moveTo(p.x + p.radius, p.y);
            context.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            context.closePath();
            if (i) {
                ribbonQuad(samples[i - 1], p).forEach((q, j) => j ? context.lineTo(q.x, q.y) : context.moveTo(q.x, q.y));
                context.closePath();
            }
        });
        context.globalAlpha = opacity;
        context.fill();
    }
    context.restore();
};

export const hitPaintbrush = (points: readonly StickerPoint[], width: number, point: StickerPoint, tolerance: number, weights?: readonly number[]) => {
    const samples = paintbrushSamples(points, width, weights);
    return samples.some((p, i) => {
        if (Math.hypot(point.x - p.x, point.y - p.y) <= p.radius + tolerance) return true;
        if (!i) return false;
        const a = samples[i - 1], dx = p.x - a.x, dy = p.y - a.y;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= a.radius + t * (p.radius - a.radius) + tolerance;
    });
};
