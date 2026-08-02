import { afterEach, describe, expect, it, vi } from "vitest";

import { renderStickerComposite, renderStickerCompositeWithAnnotations } from "../../src/services/stickerExport";
import { graphStore } from "../../src/store/graphStore";
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
        graphStore.setUnits([]);
        graphStore.setLinks([]);
        graphStore.setCapabilities([]);
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

        const unit = makeUnit();
        unit.data.stickerEditPropagation = {
            upstreamSourceFrame: { w: 100, h: 100 },
            upstreamContentFrame: { x: 0, y: 0, w: 100, h: 100 },
        };

        await renderStickerCompositeWithAnnotations(unit, [], {
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

    it("exports a cropped upstream sticker inside its updated contained frame", async () => {
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

        const unit = makeUnit();
        unit.data.imageEditState = {
            contentEraseStrokes: [],
            cropRect: { x: 25, y: 0, w: 50, h: 100 },
            sourceSize: { w: 100, h: 100 },
        };
        unit.data.stickerEditPropagation = {
            upstreamSourceFrame: { w: 50, h: 100 },
            upstreamContentFrame: { x: 0, y: 0, w: 50, h: 100 },
        };

        await renderStickerCompositeWithAnnotations(unit, [], {
            baseImageSrcOverride: "data:image/png;base64,UPSTREAM_SQUARE",
        });

        const baseImageDraw = drawCalls.find((call) => call[0] === "drawImage" && call.length === 10);
        expect(baseImageDraw?.slice(2)).toEqual([25, 0, 50, 100, 75, 0, 50, 100]);
    });

    it("uses the same upstream-resolved base image that the sticker is visibly showing before compositing effects", async () => {
        const drawCalls: Array<[string, ...unknown[]]> = [];
        const canvases: Array<{ width: number; height: number }> = [];

        vi.stubGlobal("document", {
            createElement: (tagName: string) => {
                expect(tagName).toBe("canvas");
                const canvas = {
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
                canvases.push(canvas);
                return canvas;
            },
        });

        class FakeImage {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            width = 0;
            height = 0;
            naturalWidth = 0;
            naturalHeight = 0;
            set src(value: string) {
                if (value.includes("UPSTREAM_SQUARE")) {
                    this.width = 100;
                    this.height = 100;
                    this.naturalWidth = 100;
                    this.naturalHeight = 100;
                } else {
                    this.width = 200;
                    this.height = 100;
                    this.naturalWidth = 200;
                    this.naturalHeight = 100;
                }
                this.onload?.();
            }
        }
        vi.stubGlobal("Image", FakeImage);

        const upstream: Unit = {
            id: "upstream-sticker",
            type: "sticker",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            params: {},
            inputs: [],
            outputs: [],
            data: {
                src: "data:image/png;base64,UPSTREAM_SQUARE",
            },
        };
        const target = makeUnit();
        target.inputs = [{ id: "image", label: "Image", type: "image" }];
        target.data.src = "data:image/png;base64,STALE_WIDE";

        graphStore.setUnits([target, upstream]);
        graphStore.setLinks([
            {
                id: "upstream->target:image",
                fromUnitId: upstream.id,
                fromPortId: "output_image",
                toUnitId: target.id,
                toPortId: "image",
            },
        ]);

        await renderStickerComposite(target);

        const baseImageDraw = drawCalls.find(
            (call) =>
                call[0] === "drawImage"
                && typeof call[2] === "number"
                && typeof call[3] === "number"
                && typeof call[4] === "number"
                && typeof call[5] === "number",
        );
        const imageContentCropDraw = drawCalls.find(
            (call) => call[0] === "drawImage" && call.length === 10,
        );

        expect(baseImageDraw?.slice(2)).toEqual([50, 0, 100, 100]);
        expect(imageContentCropDraw?.slice(2)).toEqual([50, 0, 100, 100, 0, 0, 100, 100]);
        expect(canvases[canvases.length - 1]).toMatchObject({ width: 100, height: 100 });
    });
});
