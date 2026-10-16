import type { StickerPoint } from "../types/stickerEditing";

type BrushDisk = StickerPoint & { radius: number };

/** Reduce redundant disks before generating four SVG layers. Both centerline and
 * radius errors are bounded in sticker pixels; reversals and tips stay intact.
 * Iterative RDP avoids stack growth and operates on the capped freehand samples. */
export const reduceBrushSamples = (samples: BrushDisk[], tolerance = 0.18): BrushDisk[] => {
    if (samples.length < 3) return samples;
    const keep = new Uint8Array(samples.length);
    keep[0] = keep[samples.length - 1] = 1;
    const stack: number[] = [];
    // Anchor windows at the stroke origin, not the moving global midpoint.
    // Appending a tail must never repartition already completed windows.
    for (let start = 0; start < samples.length - 1; start += 128) {
        const end = Math.min(samples.length - 1, start + 128);
        keep[start] = keep[end] = 1;
        stack.push(start, end);
    }
    while (stack.length) {
        const end = stack.pop()!, start = stack.pop()!;
        const a = samples[start], b = samples[end];
        const dx = b.x - a.x, dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        let largest = tolerance, split = -1;
        for (let i = start + 1; i < end; i++) {
            const p = samples[i];
            const t = lengthSquared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared)) : 0;
            const error = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
                + Math.abs(p.radius - a.radius - t * (b.radius - a.radius));
            if (error > largest) { largest = error; split = i; }
        }
        if (split !== -1) {
            keep[split] = 1;
            stack.push(start, split, split, end);
        }
    }
    return samples.filter((_, i) => keep[i]);
};

// Two decimals are far below a device pixel at ordinary sticker zoom, and avoid
// serializing full IEEE-754 decimals for every disk, arc and connecting corner.
export const brushCoordinate = (value: number) => Math.round(value * 100) / 100;
