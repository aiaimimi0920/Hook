import { describe, expect, it } from "vitest";
import { appendFreehandPoint, MAX_FREEHAND_POINTS, paintbrushSamples, smoothFreehandPoints, paintbrushRenderPaths } from "../../src/services/stickerPaintbrushGeometry";
import { brushLayerOpacities, createBrushRenderChunks, opaqueBrushColor } from "../../src/services/stickerBrushRenderChunks";
import { createBrushSmoother } from "../../src/services/stickerBrushSmoothing";

const points = Array.from({ length: 6000 }, (_, i) => ({ x: i * 0.9, y: 100 + 30 * Math.sin(i / 24) }));
const style = { color: "#ef444480", width: 16, opacity: 0.5 };

describe("stable long paintbrush strokes", () => {
    it("incrementally smooths only the tail without changing the full-pass result", () => {
        const smooth = createBrushSmoother();
        const before = smooth(points.slice(0, 2048), 80);
        const after = smooth(points.slice(0, 2080), 80);
        expect(after).toEqual(smoothFreehandPoints(points.slice(0, 2080), 80, true));
        expect(after[100]).toBe(before[100]);
        expect(smooth(points.slice(0, 2), 20)).toEqual(points.slice(0, 2));
    });
    it("does not halve historical points when crossing the former cap", () => {
        const before = points.slice(0, MAX_FREEHAND_POINTS);
        const after = appendFreehandPoint(before, points[MAX_FREEHAND_POINTS], true);
        expect(after).toHaveLength(MAX_FREEHAND_POINTS + 1);
        expect(after.slice(0, -1)).toEqual(before);
        expect(after[100]).toBe(before[100]);
        expect(smoothFreehandPoints(points, 50, true)).toHaveLength(points.length);
    });
    it("keeps smoothed historical geometry fixed as the stroke grows", () => {
        const before = smoothFreehandPoints(points.slice(0, 2048), 80, true);
        const after = smoothFreehandPoints(points, 80, true);
        expect(after.slice(0, 2045)).toEqual(before.slice(0, 2045));
        expect(after.at(-1)).toEqual(points.at(-1));
        const shortSamples = paintbrushSamples(before, 16);
        const longSamples = paintbrushSamples(after, 16);
        expect(longSamples.slice(0, 1800)).toEqual(shortSamples.slice(0, 1800));
    });
    it("reuses completed chunk paths exactly across successive long-stroke updates", () => {
        const render = createBrushRenderChunks();
        const before = render(points.slice(0, 2048), style);
        const after = render(points.slice(0, 2400), style);
        for (let i = 0; i < 12; i++) expect(after[i]).toBe(before[i]);
        const longer = render(points, style);
        for (let i = 0; i < 12; i++) expect(longer[i]).toBe(before[i]);
        expect(longer.every((chunk) => chunk.samples.length <= 129)).toBe(true);
    });
    it("applies encoded color alpha once to each whole chunk layer", () => {
        expect(opaqueBrushColor(style.color)).toBe("#ef4444");
        const alpha = brushLayerOpacities(style).reduce((a, opacity) => a + (1 - a) * opacity, 0);
        expect(alpha).toBeCloseTo(0.5 * 128 / 255);
        const render = createBrushRenderChunks();
        const chunks = render(points.slice(0, 300), style);
        const paths = paintbrushRenderPaths(points.slice(0, 300), style);
        for (let layer = 0; layer < 4; layer++) {
            const chunkCommands = chunks.map((chunk) => chunk.paths[layer]).join(" ");
            expect(chunkCommands.replace(/\s/g, "")).toBe(paths[layer].path.replace(/\s/g, ""));
        }
    });
});
