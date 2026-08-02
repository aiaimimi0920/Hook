import { afterEach, describe, expect, it, vi } from "vitest";

import {
    applyLiveContentEraseToStickerLayers,
    applyRasterizedContentErase,
    createLiveStickerEraseSession,
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

    it("keeps live content erasing in decoded canvases until pointer-up and coalesces moves per frame", async () => {
        const calls: string[] = [];
        const scheduledFrames: FrameRequestCallback[] = [];
        let imageLoadCount = 0;
        let dataUrlCount = 0;
        let nextFrameId = 0;

        const createContext = (label: string) =>
            ({
                save: () => calls.push(`${label}:save`),
                restore: () => calls.push(`${label}:restore`),
                clearRect: () => calls.push(`${label}:clearRect`),
                drawImage: () => calls.push(`${label}:drawImage`),
                beginPath: () => calls.push(`${label}:beginPath`),
                moveTo: () => calls.push(`${label}:moveTo`),
                lineTo: () => calls.push(`${label}:lineTo`),
                arc: () => calls.push(`${label}:arc`),
                fill: () => calls.push(`${label}:fill`),
                stroke: () => calls.push(`${label}:stroke`),
                set fillStyle(_value: string) {},
                set strokeStyle(_value: string) {},
                set lineWidth(_value: number) {},
                set lineCap(_value: CanvasLineCap) {},
                set lineJoin(_value: CanvasLineJoin) {},
                set globalAlpha(_value: number) {},
                set globalCompositeOperation(value: GlobalCompositeOperation) {
                    calls.push(`${label}:composite:${value}`);
                },
            }) satisfies Partial<CanvasRenderingContext2D>;

        const createCanvas = (label: string): HTMLCanvasElement => {
            const context = createContext(label);
            return {
                width: 0,
                height: 0,
                getContext: () => context as unknown as CanvasRenderingContext2D,
                toDataURL: () => {
                    dataUrlCount += 1;
                    calls.push(`${label}:toDataURL`);
                    return `data:image/png;base64,${label.toUpperCase()}`;
                },
            } as unknown as HTMLCanvasElement;
        };

        const baseCanvas = createCanvas("base");
        const annotationCanvas = createCanvas("annotation");
        const previewCanvas = createCanvas("preview");
        const canvases = [baseCanvas, annotationCanvas];

        vi.stubGlobal("document", {
            createElement: (tagName: string) => {
                expect(tagName).toBe("canvas");
                return canvases.shift()!;
            },
        });
        vi.stubGlobal(
            "requestAnimationFrame",
            vi.fn((callback: FrameRequestCallback) => {
                scheduledFrames.push(callback);
                nextFrameId += 1;
                return nextFrameId;
            }),
        );
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                imageLoadCount += 1;
                queueMicrotask(() => this.onload?.());
            }
        }
        vi.stubGlobal("Image", FakeImage);

        const session = await createLiveStickerEraseSession({
            mode: "content",
            baseLayerSrc: "data:image/png;base64,BASE",
            rasterizedAnnotationLayerSrc: "data:image/png;base64,ANNOTATION",
            size: { w: 100, h: 80 },
            previewCanvas,
        });

        expect(imageLoadCount).toBe(2);
        expect(dataUrlCount).toBe(0);

        session.queueErase(
            [
                { x: 10, y: 10 },
                { x: 20, y: 20 },
            ],
            18,
        );
        session.queueErase(
            [
                { x: 20, y: 20 },
                { x: 30, y: 30 },
            ],
            18,
        );

        expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
        expect(dataUrlCount).toBe(0);

        scheduledFrames[0](0);

        expect(calls.filter((call) => call === "base:composite:destination-out")).toHaveLength(1);
        expect(
            calls.filter((call) => call === "annotation:composite:destination-out"),
        ).toHaveLength(1);
        expect(dataUrlCount).toBe(0);

        expect(session.finish()).toEqual({
            baseLayerSrc: "data:image/png;base64,BASE",
            rasterizedAnnotationLayerSrc: "data:image/png;base64,ANNOTATION",
            previewSrc: "data:image/png;base64,PREVIEW",
        });
        expect(dataUrlCount).toBe(3);
    });

    it("keeps the base bitmap untouched in annotation-only live erase mode", async () => {
        const calls: string[] = [];
        let dataUrlCount = 0;

        const createContext = (label: string) =>
            ({
                save: () => {},
                restore: () => {},
                clearRect: () => {},
                drawImage: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                arc: () => {},
                fill: () => {},
                stroke: () => {},
                set fillStyle(_value: string) {},
                set strokeStyle(_value: string) {},
                set lineWidth(_value: number) {},
                set lineCap(_value: CanvasLineCap) {},
                set lineJoin(_value: CanvasLineJoin) {},
                set globalAlpha(_value: number) {},
                set globalCompositeOperation(value: GlobalCompositeOperation) {
                    calls.push(`${label}:${value}`);
                },
            }) satisfies Partial<CanvasRenderingContext2D>;

        const createCanvas = (label: string): HTMLCanvasElement => {
            const context = createContext(label);
            return {
                width: 0,
                height: 0,
                getContext: () => context as unknown as CanvasRenderingContext2D,
                toDataURL: () => {
                    dataUrlCount += 1;
                    return `data:image/png;base64,${label.toUpperCase()}`;
                },
            } as unknown as HTMLCanvasElement;
        };

        const baseCanvas = createCanvas("base");
        const annotationCanvas = createCanvas("annotation");
        const previewCanvas = createCanvas("preview");
        const canvases = [baseCanvas, annotationCanvas];

        vi.stubGlobal("document", {
            createElement: () => canvases.shift()!,
        });
        vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
        vi.stubGlobal("cancelAnimationFrame", vi.fn());

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        vi.stubGlobal("Image", FakeImage);

        const session = await createLiveStickerEraseSession({
            mode: "annotations",
            baseLayerSrc: "data:image/png;base64,ORIGINAL_BASE",
            rasterizedAnnotationLayerSrc: "data:image/png;base64,ANNOTATION",
            size: { w: 100, h: 80 },
            previewCanvas,
        });
        session.queueErase([{ x: 20, y: 20 }], 18);

        expect(session.finish()).toEqual({
            baseLayerSrc: "data:image/png;base64,ORIGINAL_BASE",
            rasterizedAnnotationLayerSrc: "data:image/png;base64,ANNOTATION",
            previewSrc: "data:image/png;base64,PREVIEW",
        });
        expect(calls).not.toContain("base:destination-out");
        expect(calls).toContain("annotation:destination-out");
        expect(dataUrlCount).toBe(2);
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
