import type { StickerPoint, StickerStrokeStyle } from "../types/stickerEditing";
import { paintbrushSamples, samplesPath, freehandOpacity } from "./stickerPaintbrushGeometry";
import { reduceBrushSamples } from "./stickerBrushSampleReduction";
import { getStickerColorAlpha } from "./stickerStyleValues";

type Disk = StickerPoint & { radius: number };
interface RenderChunk { samples: Disk[]; paths: string[]; }
const sameDisk = (a: Disk, b: Disk) => a.x === b.x && a.y === b.y && a.radius === b.radius;

/** One cache per mounted stroke. Historical paths are immutable SVG nodes;
 * only the changing tail is re-tessellated. Stored user geometry can grow,
 * but each simplification window is bounded to 128 centers. */
export const createBrushRenderChunks = () => {
    let cached: RenderChunk[] = [];
    return (points: StickerPoint[], style: StickerStrokeStyle) => {
        const disks = paintbrushSamples(points, style.width, style.brushWeights);
        const result: RenderChunk[] = [];
        for (let start = 0; start < disks.length; start += 128) {
            const input = disks.slice(start, start + 129);
            if (start && input.length === 1) break;
            const old = cached[result.length];
            if (old && old.samples.length === input.length && old.samples.every((p, i) => sameDisk(p, input[i]))) {
                result.push(old);
                continue;
            }
            const reduced = reduceBrushSamples(input);
            result.push({ samples: input, paths: Array.from({ length: 4 }, (_, layer) => {
                const scaled = reduced.map((p) => ({ ...p, radius: p.radius * (1 - layer * 0.12 / 3) }));
                return start ? samplesPath(scaled.slice(1), scaled[0]) : samplesPath(scaled);
            }) });
        }
        cached = result;
        return result;
    };
};

/** Opacity is applied to each whole layer, not to individual chunks, so chunk
 * joins and self-overlaps do not acquire dark seams with translucent colors. */
export const brushLayerOpacities = (style: StickerStrokeStyle) => {
    const peak = getStickerColorAlpha(style.color) * freehandOpacity(style.opacity ?? 1);
    let previous = 0;
    return Array.from({ length: 4 }, (_, i) => {
        const t = (i + 1) / 4;
        const target = peak * t * t * (3 - 2 * t);
        const alpha = previous < 1 ? (target - previous) / (1 - previous) : 0;
        previous = target;
        return alpha;
    });
};

export const opaqueBrushColor = (color: string) => /^#[0-9a-f]{8}$/i.test(color) ? color.slice(0, 7) : color;
