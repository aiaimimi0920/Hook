import type { StickerPoint } from "../types/stickerEditing";

/** Event timing is draft-only. Persist dimensionless weights, so later transforms
 * cannot reinterpret movement speed or change the character of a saved stroke. */
export interface BrushSample extends StickerPoint {
    sampleTime?: number;
    brushWeight?: number;
}

export const brushWeight = (value: number | undefined) =>
    Number.isFinite(value) ? Math.max(0.4, Math.min(1, value!)) : 0.85;

export const sampleBrushMotion = (point: StickerPoint, time: number, previous?: BrushSample): BrushSample => {
    const sampleTime = Number.isFinite(time) ? time : previous?.sampleTime ?? 0;
    if (!previous) return { ...point, sampleTime, brushWeight: 0.85 };
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const elapsed = sampleTime - (previous.sampleTime ?? sampleTime);
    const prior = brushWeight(previous.brushWeight);
    // Invalid/non-increasing timestamps retain the previous weight; a pause cannot
    // instantly inflate the next sample. Spatial easing limits abrupt width steps.
    const speed = elapsed > 0 ? distance / Math.max(4, Math.min(80, elapsed)) : 0;
    const target = elapsed > 0 ? 0.42 + 0.58 / (1 + speed * 1.5) : prior;
    const blend = Math.min(0.32, 1 - Math.exp(-distance / 18));
    return { ...point, sampleTime, brushWeight: prior + (target - prior) * blend };
};

export const brushWeights = (points: readonly BrushSample[]) => points.map((point) => brushWeight(point.brushWeight));
