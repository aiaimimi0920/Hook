import { afterEach, describe, expect, it, vi } from "vitest";

import { renderStickerComposite } from "../../src/services/stickerExport";
import { HIGHLIGHTER_LAYER_OPACITY } from "../../src/services/stickerEditing";
import type { Unit } from "../../src/types/unit";
import type { StickerLineAnnotation } from "../../src/types/stickerEditing";

const highlighter = (id: string, points: Array<{ x: number; y: number }>): StickerLineAnnotation => ({
    id,
    type: "highlighter",
    zIndex: id === "hl-1" ? 1 : 2,
    points,
    style: { color: "#facc15", width: 14, opacity: HIGHLIGHTER_LAYER_OPACITY },
});

const makeUnit = (): Unit => ({
    id: "sticker-hl",
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
                // Two overlapping highlighter strokes crossing the same band.
                highlighter("hl-1", [
                    { x: 10, y: 60 },
                    { x: 190, y: 60 },
                ]),
                highlighter("hl-2", [
                    { x: 10, y: 60 },
                    { x: 190, y: 60 },
                ]),
            ],
        },
        imageEditState: { contentEraseStrokes: [] },
    },
});

type Call = [string, ...unknown[]];

describe("highlighter export compositing", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("composites highlighters through one layer at HIGHLIGHTER_LAYER_OPACITY, not per stroke", () => {
        const mainCalls: Call[] = [];
        const layerCalls: Call[] = [];

        const makeContext = (calls: Call[]) => ({
            save: () => calls.push(["save"]),
            restore: () => calls.push(["restore"]),
            beginPath: () => calls.push(["beginPath"]),
            moveTo: (...a: number[]) => calls.push(["moveTo", ...a]),
            lineTo: (...a: number[]) => calls.push(["lineTo", ...a]),
            stroke: () => calls.push(["stroke"]),
            rect: (...a: number[]) => calls.push(["rect", ...a]),
            clip: () => calls.push(["clip"]),
            fillRect: (...a: number[]) => calls.push(["fillRect", ...a]),
            drawImage: (...a: unknown[]) => calls.push(["drawImage", ...a]),
            set globalAlpha(value: number) {
                calls.push(["globalAlpha", value]);
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
        });

        // First canvas created is the main composite; subsequent canvas is the
        // offscreen highlighter layer.
        let created = 0;
        vi.stubGlobal("document", {
            createElement: (tagName: string) => {
                expect(tagName).toBe("canvas");
                created += 1;
                const isMain = created === 1;
                const calls = isMain ? mainCalls : layerCalls;
                return {
                    width: 0,
                    height: 0,
                    getContext: () => makeContext(calls),
                    toDataURL: () => "data:image/png;base64,OUT",
                };
            },
        });

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 200;
            height = 120;
            set src(_value: string) {
                this.onload?.();
            }
        }
        vi.stubGlobal("Image", FakeImage);

        return renderStickerComposite(makeUnit()).then(() => {
            // Each highlighter is a single solid same-color stroke in the
            // offscreen buffer, so two strokes produce two stroke calls. The
            // wash opacity is applied once at composite time, never per stroke,
            // so the offscreen layer itself stays at full opacity.
            const layerAlphas = layerCalls
                .filter((call) => call[0] === "globalAlpha")
                .map((call) => call[1] as number);
            expect(layerCalls.filter((call) => call[0] === "stroke")).toHaveLength(2);
            expect(layerAlphas.every((alpha) => alpha === 1)).toBe(true);

            // Main context composited the layer exactly once at the wash opacity,
            // and never stroked highlighter paths directly.
            expect(mainCalls).toContainEqual(["globalAlpha", HIGHLIGHTER_LAYER_OPACITY]);
            expect(mainCalls.some((call) => call[0] === "stroke")).toBe(false);
            expect(mainCalls.filter((call) => call[0] === "drawImage").length).toBeGreaterThanOrEqual(1);
        });
    });
});
