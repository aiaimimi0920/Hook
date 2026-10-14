import { describe, expect, it } from "vitest";
import { brushWeights, sampleBrushMotion, type BrushSample } from "../../src/services/stickerBrushDynamics";
import { paintbrushSamples } from "../../src/services/stickerPaintbrushGeometry";
import { scaleAnnotationAroundCenter } from "../../src/services/stickerAnnotationTransforms";
import { translateAnnotation } from "../../src/services/stickerAnnotationEditGeometry";
import type { StickerLineAnnotation } from "../../src/types/stickerEditing";

const stroke = (interval: number) => {
    const points: BrushSample[] = [];
    for (let i = 0; i < 30; i++) points.push(sampleBrushMotion({ x: i * 8, y: 0 }, i * interval, points.at(-1)));
    return points;
};

describe("mouse brush dynamics", () => {
    it("makes fast motion lighter than slow motion on the same path", () => {
        const slow = stroke(40), fast = stroke(4);
        expect(slow[20].brushWeight!).toBeGreaterThan(fast[20].brushWeight! + 0.2);
        const widths = paintbrushSamples(fast, 30, brushWeights(fast));
        expect(widths[0].radius).toBeGreaterThan(widths.at(-1)!.radius * 5);
    });
    it("eases sudden speed changes and handles pauses or malformed timestamps", () => {
        const first = sampleBrushMotion({ x: 0, y: 0 }, 0);
        const fast = sampleBrushMotion({ x: 100, y: 0 }, 4, first);
        expect(Math.abs(fast.brushWeight! - first.brushWeight!)).toBeLessThan(0.15);
        const paused = sampleBrushMotion({ x: 101, y: 0 }, 10000, fast);
        expect(Math.abs(paused.brushWeight! - fast.brushWeight!)).toBeLessThan(0.03);
        expect(sampleBrushMotion({ x: 110, y: 0 }, NaN, fast).brushWeight).toBe(fast.brushWeight);
    });
    it("persists dimensionless weights through serialization and transforms", () => {
        const points = stroke(10);
        const line: StickerLineAnnotation = { id: "brush", type: "brush", zIndex: 1,
            points: points.map(({ x, y }) => ({ x, y })),
            style: { color: "#ff0000", width: 20, brushTip: "tapered", brushWeights: brushWeights(points) } };
        const restored = JSON.parse(JSON.stringify(line)) as StickerLineAnnotation;
        expect(translateAnnotation(restored, 10, 20).style.brushWeights).toEqual(line.style.brushWeights);
        expect(scaleAnnotationAroundCenter(restored, { x: 2, y: 2 }).style.brushWeights).toEqual(line.style.brushWeights);
    });
});
