import { afterEach, describe, expect, it, vi } from "vitest";

import { renderStickerCompositeWithAnnotations } from "../../src/services/stickerExport";
import type { Unit } from "../../src/types/unit";

const makeUnit = (): Unit => ({
    id: "sticker-contain-export",
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
        imageEditState: { contentEraseStrokes: [] },
    },
});

describe("sticker composite export base-image placement", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("contain-fits an uncropped square source into a wider sticker frame instead of stretching it", async () => {
        const drawCalls: Array<[string, ...unknown[]]> = [];

        vi.stubGlobal("document", {
            createElement: (tagName: string) => {
                expect(tagName).toBe("canvas");
                return {
                    width: 0,
                    height: 0,
                    getContext: () => ({
                        save: () => drawCalls.push(["save"]),
                        restore: () => drawCalls.push(["restore"]),
                        beginPath: () => drawCalls.push(["beginPath"]),
                        closePath: () => drawCalls.push(["closePath"]),
                        roundRect: () => drawCalls.push(["roundRect"]),
                        clip: () => drawCalls.push(["clip"]),
                        drawImage: (...args: unknown[]) => drawCalls.push(["drawImage", ...args]),
                        fillRect: (...args: unknown[]) => drawCalls.push(["fillRect", ...args]),
                        strokeRect: (...args: unknown[]) => drawCalls.push(["strokeRect", ...args]),
                        set globalAlpha(value: number) {
                            drawCalls.push(["globalAlpha", value]);
                        },
                        set strokeStyle(value: string) {
                            drawCalls.push(["strokeStyle", value]);
                        },
                        set lineWidth(value: number) {
                            drawCalls.push(["lineWidth", value]);
                        },
                    }),
                    toDataURL: () => "data:image/png;base64,OUT",
                };
            },
        });

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 100;
            height = 100;
            naturalWidth = 100;
            naturalHeight = 100;
            set src(_value: string) {
                this.onload?.();
            }
        }
        vi.stubGlobal("Image", FakeImage);

        await renderStickerCompositeWithAnnotations(makeUnit(), [], {
            baseImageSrcOverride: "data:image/png;base64,UPSTREAM_SQUARE",
        });

        const baseImageDraw = drawCalls.find(
            (call) =>
                call[0] === "drawImage"
                && typeof call[2] === "number"
                && typeof call[3] === "number"
                && typeof call[4] === "number"
                && typeof call[5] === "number",
        );

        expect(baseImageDraw?.slice(2)).toEqual([50, 0, 100, 100]);
    });
});
