import { afterEach, describe, expect, it, vi } from "vitest";

import {
    applyLiveContentEraseToStickerLayers,
    applyRasterizedContentErase,
    eraseRasterizedAnnotationLayer,
    flipRasterizedAnnotationLayer,
} from "../../src/services/stickerBitmapLayers";

describe("stickerBitmapLayers", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("erases a single-click annotation eraser point as a round bitmap dot", async () => {
        const calls: string[] = [];
        const context = {
            save: () => calls.push("save"),
            restore: () => calls.push("restore"),
            drawImage: () => calls.push("drawImage"),
            beginPath: () => calls.push("beginPath"),
            moveTo: () => calls.push("moveTo"),
            lineTo: () => calls.push("lineTo"),
            arc: () => calls.push("arc"),
            fill: () => calls.push("fill"),
            stroke: () => calls.push("stroke"),
            set fillStyle(_value: string) {
                calls.push("fillStyle");
            },
            set strokeStyle(_value: string) {
                calls.push("strokeStyle");
            },
            set lineWidth(_value: number) {
                calls.push("lineWidth");
            },
            set lineCap(_value: CanvasLineCap) {
                calls.push("lineCap");
            },
            set lineJoin(_value: CanvasLineJoin) {
                calls.push("lineJoin");
            },
            set globalAlpha(_value: number) {
                calls.push("globalAlpha");
            },
            set globalCompositeOperation(_value: GlobalCompositeOperation) {
                calls.push("globalCompositeOperation");
            },
        } satisfies Partial<CanvasRenderingContext2D>;

        const canvas = {
            width: 0,
            height: 0,
            getContext: () => context,
            toDataURL: () => "data:image/png;base64,ERASED",
        } satisfies Partial<HTMLCanvasElement>;

        vi.stubGlobal("document", {
            createElement: (tagName: string) => {
                expect(tagName).toBe("canvas");
                return canvas;
            },
        });

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        vi.stubGlobal("Image", FakeImage);

        const result = await eraseRasterizedAnnotationLayer({
            rasterizedAnnotationLayerSrc: "data:image/png;base64,LAYER",
            size: { w: 100, h: 80 },
            points: [{ x: 40, y: 30 }],
            width: 18,
        });

        expect(result).toBe("data:image/png;base64,ERASED");
        expect(calls).toContain("globalCompositeOperation");
        expect(calls).toContain("arc");
        expect(calls).toContain("fill");
    });

    it("erases content pixels to transparent instead of painting the target color", async () => {
        const calls: string[] = [];
        const context = {
            save: () => calls.push("save"),
            restore: () => calls.push("restore"),
            drawImage: () => calls.push("drawImage"),
            beginPath: () => calls.push("beginPath"),
            moveTo: () => calls.push("moveTo"),
            lineTo: () => calls.push("lineTo"),
            arc: () => calls.push("arc"),
            fill: () => calls.push("fill"),
            stroke: () => calls.push("stroke"),
            set fillStyle(value: string) {
                calls.push(`fillStyle:${value}`);
            },
            set strokeStyle(value: string) {
                calls.push(`strokeStyle:${value}`);
            },
            set lineWidth(value: number) {
                calls.push(`lineWidth:${value}`);
            },
            set lineCap(value: CanvasLineCap) {
                calls.push(`lineCap:${value}`);
            },
            set lineJoin(value: CanvasLineJoin) {
                calls.push(`lineJoin:${value}`);
            },
            set globalAlpha(value: number) {
                calls.push(`globalAlpha:${value}`);
            },
            set globalCompositeOperation(value: GlobalCompositeOperation) {
                calls.push(`globalCompositeOperation:${value}`);
            },
        } satisfies Partial<CanvasRenderingContext2D>;

        let dataUrlCounter = 0;
        const canvas = {
            width: 0,
            height: 0,
            getContext: () => context,
            toDataURL: () => {
                dataUrlCounter += 1;
                calls.push(`toDataURL:${dataUrlCounter}`);
                return `data:image/png;base64,RESULT_${dataUrlCounter}`;
            },
        } satisfies Partial<HTMLCanvasElement>;

        vi.stubGlobal("document", {
            createElement: (tagName: string) => {
                expect(tagName).toBe("canvas");
                return canvas;
            },
        });

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        vi.stubGlobal("Image", FakeImage);

        const result = await applyRasterizedContentErase({
            baseLayerSrc: "data:image/png;base64,BASE",
            rasterizedAnnotationLayerSrc: "data:image/png;base64,LAYER",
            size: { w: 100, h: 80 },
            stroke: {
                points: [
                    { x: 10, y: 20 },
                    { x: 40, y: 50 },
                ],
                color: "#ff00ff",
                width: 18,
                opacity: 1,
            },
        });

        expect(result.baseLayerSrc).toBe("data:image/png;base64,RESULT_1");
        expect(result.rasterizedAnnotationLayerSrc).toBe("data:image/png;base64,RESULT_2");
        expect(result.previewSrc).toBe("data:image/png;base64,RESULT_3");
        expect(calls.indexOf("globalCompositeOperation:destination-out")).toBeLessThan(
            calls.indexOf("toDataURL:1"),
        );
        expect(calls).not.toContain("strokeStyle:#ff00ff");
    });

    it("preserves the rasterized annotation layer while applying live content erase", async () => {
        const calls: string[] = [];
        const context = {
            save: () => calls.push("save"),
            restore: () => calls.push("restore"),
            drawImage: () => calls.push("drawImage"),
            beginPath: () => calls.push("beginPath"),
            moveTo: () => calls.push("moveTo"),
            lineTo: () => calls.push("lineTo"),
            arc: () => calls.push("arc"),
            fill: () => calls.push("fill"),
            stroke: () => calls.push("stroke"),
            set fillStyle(value: string) {
                calls.push(`fillStyle:${value}`);
            },
            set strokeStyle(value: string) {
                calls.push(`strokeStyle:${value}`);
            },
            set lineWidth(value: number) {
                calls.push(`lineWidth:${value}`);
            },
            set lineCap(value: CanvasLineCap) {
                calls.push(`lineCap:${value}`);
            },
            set lineJoin(value: CanvasLineJoin) {
                calls.push(`lineJoin:${value}`);
            },
            set globalAlpha(value: number) {
                calls.push(`globalAlpha:${value}`);
            },
            set globalCompositeOperation(value: GlobalCompositeOperation) {
                calls.push(`globalCompositeOperation:${value}`);
            },
        } satisfies Partial<CanvasRenderingContext2D>;

        let dataUrlCounter = 0;
        const canvas = {
            width: 0,
            height: 0,
            getContext: () => context,
            toDataURL: () => {
                dataUrlCounter += 1;
                calls.push(`toDataURL:${dataUrlCounter}`);
                return `data:image/png;base64,RESULT_${dataUrlCounter}`;
            },
        } satisfies Partial<HTMLCanvasElement>;

        vi.stubGlobal("document", {
            createElement: (tagName: string) => {
                expect(tagName).toBe("canvas");
                return canvas;
            },
        });

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        vi.stubGlobal("Image", FakeImage);

        const result = await applyLiveContentEraseToStickerLayers({
            baseLayerSrc: "data:image/png;base64,BASE",
            rasterizedAnnotationLayerSrc: "data:image/png;base64,LAYER",
            size: { w: 100, h: 80 },
            stroke: {
                points: [
                    { x: 12, y: 18 },
                    { x: 40, y: 45 },
                ],
                color: "#000000",
                width: 18,
                opacity: 1,
            },
        });

        expect(result.baseLayerSrc).toBe("data:image/png;base64,RESULT_1");
        expect(result.rasterizedAnnotationLayerSrc).toBe("data:image/png;base64,RESULT_2");
        expect(result.previewSrc).toBe("data:image/png;base64,RESULT_3");
        expect(calls).toContain("globalCompositeOperation:destination-out");
    });

    it("flips a rasterized annotation bitmap layer across the requested axis", async () => {
        const calls: string[] = [];
        const context = {
            save: () => calls.push("save"),
            restore: () => calls.push("restore"),
            drawImage: () => calls.push("drawImage"),
            translate: (x: number, y: number) => calls.push(`translate:${x},${y}`),
            scale: (x: number, y: number) => calls.push(`scale:${x},${y}`),
        } satisfies Partial<CanvasRenderingContext2D>;

        const canvas = {
            width: 0,
            height: 0,
            getContext: () => context,
            toDataURL: () => "data:image/png;base64,FLIPPED",
        } satisfies Partial<HTMLCanvasElement>;

        vi.stubGlobal("document", {
            createElement: (tagName: string) => {
                expect(tagName).toBe("canvas");
                return canvas;
            },
        });

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        vi.stubGlobal("Image", FakeImage);

        const result = await flipRasterizedAnnotationLayer({
            rasterizedAnnotationLayerSrc: "data:image/png;base64,LAYER",
            size: { w: 120, h: 80 },
            axis: "x",
        });

        expect(result).toBe("data:image/png;base64,FLIPPED");
        expect(calls).toContain("translate:120,0");
        expect(calls).toContain("scale:-1,1");
        expect(calls).toContain("drawImage");
    });
});
