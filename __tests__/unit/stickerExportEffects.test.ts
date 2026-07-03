import { afterEach, describe, expect, it, vi } from "vitest";

import { renderStickerTransparentAnnotationLayer } from "../../src/services/stickerExport";
import type { Unit } from "../../src/types/unit";

// Brush-stroke mosaic/blur: the effect stores stroke points + a brush width and a
// bounding box. Export renders the full effect into an offscreen layer (box-local
// coordinates), masks it down to the brush stroke with destination-in, then
// composites the masked layer back at the bounding-box origin. There is no
// rectangle border anymore.
const makeEffectUnit = (type: "mosaic" | "blur"): Unit => ({
    id: `sticker-${type}`,
    type: "sticker",
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        src: "data:image/png;base64,BASE",
        annotationState: {
            serialCounter: 1,
            elements: [
                {
                    id: `${type}-1`,
                    type,
                    zIndex: 1,
                    x: 30,
                    y: 32,
                    w: 50,
                    h: 20,
                    points: [
                        { x: 40, y: 42 },
                        { x: 70, y: 48 },
                    ],
                    brushWidth: 16,
                    strength: type === "mosaic" ? 12 : 8,
                    style:
                        type === "mosaic"
                            ? { color: "#ff00ff", width: 0, fill: "#111111", secondaryFill: "#eeeeee" }
                            : { color: "#00ffcc", width: 0 },
                },
            ],
        },
        imageEditState: { contentEraseStrokes: [] },
    },
});

describe("sticker effect export rasterization", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const installCanvas = () => {
        const calls: Array<[string, ...unknown[]]> = [];
        const context = {
            save: () => calls.push(["save"]),
            restore: () => calls.push(["restore"]),
            beginPath: () => calls.push(["beginPath"]),
            rect: (...args: number[]) => calls.push(["rect", ...args]),
            clip: () => calls.push(["clip"]),
            arc: (...args: number[]) => calls.push(["arc", ...args]),
            moveTo: (...args: number[]) => calls.push(["moveTo", ...args]),
            lineTo: (...args: number[]) => calls.push(["lineTo", ...args]),
            stroke: () => calls.push(["stroke"]),
            fill: () => calls.push(["fill"]),
            fillRect: (...args: number[]) => calls.push(["fillRect", ...args]),
            drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
            createPattern: () => {
                calls.push(["createPattern"]);
                return "__pattern__" as unknown as CanvasPattern;
            },
            createImageData: (w: number, h: number) => {
                calls.push(["createImageData", w, h]);
                return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as unknown as ImageData;
            },
            putImageData: (...args: unknown[]) => calls.push(["putImageData", ...args]),
            set fillStyle(value: string) {
                calls.push(["fillStyle", value]);
            },
            set strokeStyle(value: string) {
                calls.push(["strokeStyle", value]);
            },
            set lineWidth(value: number) {
                calls.push(["lineWidth", value]);
            },
            set lineCap(value: string) {
                calls.push(["lineCap", value]);
            },
            set lineJoin(value: string) {
                calls.push(["lineJoin", value]);
            },
            set globalCompositeOperation(value: string) {
                calls.push(["globalCompositeOperation", value]);
            },
            set filter(value: string) {
                calls.push(["filter", value]);
            },
            get filter() {
                return "none";
            },
        } satisfies Partial<CanvasRenderingContext2D>;

        const canvas = {
            width: 0,
            height: 0,
            getContext: () => context,
            toDataURL: () => "data:image/png;base64,LAYER",
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
            width = 200;
            height = 120;
            naturalWidth = 200;
            naturalHeight = 120;
            set src(_value: string) {
                queueMicrotask(() => this.onload?.());
            }
        }
        vi.stubGlobal("Image", FakeImage);

        return calls;
    };

    it("paints a non-repeating mosaic grid, masks it to the stroke, and composites at the box origin", async () => {
        const calls = installCanvas();

        await renderStickerTransparentAnnotationLayer(makeEffectUnit("mosaic"), ["mosaic-1"]);

        // Mosaic is a grid of square cells (fillRect per cell), colored from a
        // blue-gray palette by absolute position so the grid never repeats. It never
        // samples the source image, so the censored content cannot leak.
        expect(calls.some(([name]) => name === "fillRect")).toBe(true);
        // The grid is masked down to the brush stroke (destination-in), then the
        // masked layer is composited back at the bounding-box origin. No border.
        expect(calls).toContainEqual(["globalCompositeOperation", "destination-in"]);
        expect(calls.some(([name]) => name === "strokeRect")).toBe(false);
        const composite = calls.find(
            (call): call is ["drawImage", unknown, number, number] =>
                call[0] === "drawImage" && typeof call[2] === "number" && typeof call[3] === "number",
        );
        expect(composite?.[2]).toBe(30);
        expect(composite?.[3]).toBe(32);
    });

    it("blurs source pixels, keeps the overlay tint, masks the stroke, and drops the border", async () => {
        const calls = installCanvas();

        await renderStickerTransparentAnnotationLayer(makeEffectUnit("blur"), ["blur-1"]);

        expect(calls).toContainEqual(["filter", "blur(8px)"]);
        expect(calls.some(([name]) => name === "drawImage")).toBe(true);
        // Live overlay tint preserved, old wrong constant absent.
        expect(calls).not.toContainEqual(["fillStyle", "rgba(255,255,255,0.10)"]);
        expect(calls).toContainEqual(["fillStyle", "rgba(255,255,255,0.08)"]);
        // Masked to the brush stroke, no rectangle border.
        expect(calls).toContainEqual(["globalCompositeOperation", "destination-in"]);
        expect(calls.some(([name]) => name === "strokeRect")).toBe(false);
    });
});
