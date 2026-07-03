import { afterEach, describe, expect, it, vi } from "vitest";

import { renderStickerComposite } from "../../src/services/stickerExport";
import { createDefaultBeautifyState } from "../../src/services/stickerBeautify";
import type { Unit } from "../../src/types/unit";

const makeUnit = (beautifyEnabled: boolean): Unit => ({
    id: "sticker-beautify",
    type: "sticker",
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        src: "data:image/png;base64,BASE",
        annotationState: { serialCounter: 1, elements: [] },
        imageEditState: {
            contentEraseStrokes: [],
            beautify: { ...createDefaultBeautifyState(), enabled: beautifyEnabled, padding: 40 },
        },
    },
});

describe("beautify export", () => {
    afterEach(() => vi.unstubAllGlobals());

    const installCanvas = () => {
        const canvases: Array<{ width: number; height: number }> = [];
        vi.stubGlobal("document", {
            createElement: (tagName: string) => {
                expect(tagName).toBe("canvas");
                const canvas = {
                    width: 0,
                    height: 0,
                    getContext: () => ({
                        save: () => {},
                        restore: () => {},
                        beginPath: () => {},
                        closePath: () => {},
                        roundRect: () => {},
                        clip: () => {},
                        fill: () => {},
                        fillRect: () => {},
                        drawImage: () => {},
                        createLinearGradient: () => ({ addColorStop: () => {} }),
                        set fillStyle(_v: unknown) {},
                        set shadowColor(_v: unknown) {},
                        set shadowBlur(_v: unknown) {},
                        set shadowOffsetY(_v: unknown) {},
                        set globalAlpha(_v: unknown) {},
                        set strokeStyle(_v: unknown) {},
                        set lineWidth(_v: unknown) {},
                        set lineCap(_v: unknown) {},
                        set lineJoin(_v: unknown) {},
                    }),
                    toDataURL: () => "data:image/png;base64,OUT",
                };
                canvases.push(canvas);
                return canvas;
            },
        });
        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 200;
            height = 100;
            set src(_value: string) {
                this.onload?.();
            }
        }
        vi.stubGlobal("Image", FakeImage);
        return canvases;
    };

    it("expands the canvas by padding on every side when beautify is enabled", async () => {
        const canvases = installCanvas();
        await renderStickerComposite(makeUnit(true));
        // The beautified canvas (last created) is inner + padding*2 = 200+80 x 100+80.
        const beautified = canvases[canvases.length - 1];
        expect(beautified.width).toBe(280);
        expect(beautified.height).toBe(180);
    });

    it("leaves the canvas at composite size when beautify is disabled", async () => {
        const canvases = installCanvas();
        await renderStickerComposite(makeUnit(false));
        // No beautify pass: the only/last canvas keeps the composite size.
        const last = canvases[canvases.length - 1];
        expect(last.width).toBe(200);
        expect(last.height).toBe(100);
    });
});
