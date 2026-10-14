import { describe, expect, it } from "vitest";
import { reduceBrushSamples } from "../../src/services/stickerBrushSampleReduction";
import { paintbrushRenderPaths } from "../../src/services/stickerPaintbrushGeometry";

describe("bounded brush rendering geometry", () => {
    it("removes redundant disks but preserves endpoints and radius extrema", () => {
        const samples = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0, radius: 5 }));
        expect(reduceBrushSamples(samples)).toEqual([samples[0], samples[99]]);
        samples[50].radius = 9;
        expect(reduceBrushSamples(samples)).toContain(samples[50]);
    });
    it("retains reversals and sharp corners instead of shortcutting the stroke", () => {
        const samples = [{ x: 0, y: 0, radius: 5 }, { x: 20, y: 0, radius: 5 },
            { x: 0, y: 0, radius: 5 }, { x: 0, y: 20, radius: 5 }];
        expect(reduceBrushSamples(samples)).toEqual(samples);
    });
    it("keeps long smooth SVG input below the previous multi-megabyte path size", () => {
        const points = Array.from({ length: 2048 }, (_, i) => ({ x: i * 0.8, y: 100 + 50 * Math.sin(i / 32) }));
        const paths = paintbrushRenderPaths(points, { width: 16, color: "#ef4444", opacity: 1 });
        expect(paths).toHaveLength(4);
        expect(paths.reduce((sum, path) => sum + path.path.length, 0)).toBeLessThan(250000);
    });
});
