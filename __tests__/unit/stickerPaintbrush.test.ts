import { describe, expect, it, vi } from "vitest";
import { appendFreehandPoint, drawPaintbrush, hitPaintbrush, MAX_FREEHAND_POINTS, paintbrushPath, paintbrushSamples, paintbrushLayers, smoothFreehandPoints } from "../../src/services/stickerPaintbrushGeometry";
import { createDefaultStickerToolSettings } from "../../src/services/stickerEditingDefaults";
import { applyStickerToolSettingsPatch, normalizeStickerToolSettings } from "../../src/services/toolSettings";

const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }];
describe("natural paintbrush geometry", () => {
    it("keeps a rounded entry and an asymmetric fine exit, including sparse input", () => {
        const samples = paintbrushSamples([points[0], points[2]], 20);
        expect(samples[0].radius).toBeCloseTo(6.8);
        expect(samples.at(-1)!.radius).toBeCloseTo(0.68);
        expect(Math.max(...samples.map((p) => p.radius))).toBe(8.5);
        expect(paintbrushSamples([points[0]], 20)).toEqual([{ x: 0, y: 0, radius: 10 }]);
        expect(paintbrushPath([], 20)).toBe("");
    });
    it("bakes smoothing without moving the endpoints or modifying source points", () => {
        const source = [{ x: 0, y: 0 }, { x: 30, y: 50 }, { x: 60, y: 0 }];
        const smooth = smoothFreehandPoints(source, 100);
        expect(smooth[0]).toEqual(source[0]);
        expect(smooth[2]).toEqual(source[2]);
        expect(smooth[1].y).toBeLessThan(source[1].y);
        expect(source[1].y).toBe(50);
        expect(smoothFreehandPoints(source, 0)).toEqual(source);
    });
    it("bounds work and rejects malformed coordinates", () => {
        const many = Array.from({ length: 10000 }, (_, i) => ({ x: i, y: i % 7 }));
        expect(paintbrushSamples(many, 1).length).toBeLessThanOrEqual(many.length * 8);
        expect(paintbrushPath([{ x: NaN, y: 2 }, { x: 0, y: Infinity }], NaN)).toBe("");
        const live = many.slice(0, MAX_FREEHAND_POINTS);
        const appended = appendFreehandPoint(live, { x: 4000, y: 1 });
        expect(appended.length).toBeLessThan(MAX_FREEHAND_POINTS);
        expect(appended.at(-1)).toEqual({ x: 4000, y: 1 });
    });
    it("hit-tests the tapered width rather than the full pencil width at the tips", () => {
        expect(hitPaintbrush(points, 20, { x: 100, y: 8 }, 0)).toBe(true);
        expect(hitPaintbrush(points, 20, { x: 0, y: 8 }, 0)).toBe(false);
        expect(hitPaintbrush(points, 20, { x: 0, y: 1 }, 0)).toBe(true);
    });
    it("fills each soft band once and preserves color alpha and opacity at the center", () => {
        const context = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), closePath: vi.fn(), fill: vi.fn() } as unknown as CanvasRenderingContext2D;
        drawPaintbrush(context, points, { width: 20, color: "#ef444480", opacity: 0.5 });
        expect(context.fill).toHaveBeenCalledTimes(4);
        const layers = paintbrushLayers(points, { width: 20, color: "#ef444480", opacity: 0.5 });
        const alpha = layers.reduce((a, layer) => a + (1 - a) * layer.opacity * (128 / 255), 0);
        expect(alpha).toBeCloseTo(0.5 * 128 / 255);
        expect(layers[0].opacity).toBeLessThan(0.1);
        expect(layers[3].samples[0].radius / layers[0].samples[0].radius).toBeCloseTo(0.88);
        expect(context.restore).toHaveBeenCalledOnce();
    });
    it("keeps independent pencil and paintbrush profiles through reload", () => {
        let settings = applyStickerToolSettingsPatch(createDefaultStickerToolSettings(), { activeTool: "paintbrush", domain: "create" });
        expect(settings.strokeWidth).toBe(16);
        settings = applyStickerToolSettingsPatch(settings, { strokeWidth: 23, brushOpacity: 0.4, brushSmoothing: 80 });
        settings = applyStickerToolSettingsPatch(settings, { activeTool: "brush" });
        expect(settings.strokeWidth).toBe(3);
        expect(settings.brushOpacity).toBe(1);
        settings = applyStickerToolSettingsPatch(settings, { activeTool: "paintbrush" });
        expect(normalizeStickerToolSettings(settings)).toMatchObject({ activeTool: "paintbrush", strokeWidth: 23, brushOpacity: 0.4, brushSmoothing: 80 });
    });
});
