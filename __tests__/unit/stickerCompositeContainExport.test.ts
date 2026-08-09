import { afterEach, describe, expect, it, vi } from "vitest";

import {
    renderStickerComposite,
    renderStickerCompositeWithAnnotations,
    resolveDirectStickerExportImageSrc,
} from "../../src/services/stickerExport";
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

    it("passes an untouched sticker's connected Art formal output through byte-for-byte", async () => {
        const upstream: Unit = {
            id: "upstream-art",
            type: "art",
            artId: "workflow-preview-formal",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            params: {},
            inputs: [],
            outputs: [{ id: "output", type: "image", direction: "output" }],
            data: {
                previewSrc: "data:image/png;base64,SHADER_PREVIEW",
                outputs: {
                    output: "data:image/png;base64,COMPRESSED_FORMAL",
                },
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
                fromPortId: "output",
                toUnitId: target.id,
                toPortId: "image",
            },
        ]);

        await expect(renderStickerComposite(target)).resolves.toBe(
            "data:image/png;base64,COMPRESSED_FORMAL",
        );
    });

    it("requires Canvas rendering when the sticker changes the connected image", () => {
        const unit = makeUnit();
        const input = { unit, units: [unit], links: [] };

        expect(resolveDirectStickerExportImageSrc(input)).toBe(
            "data:image/png;base64,BASE",
        );

        unit.data.opacityNormal = 0.5;
        expect(resolveDirectStickerExportImageSrc(input)).toBeUndefined();

        unit.data.opacityNormal = 1;
        unit.data.annotationState = {
            serialCounter: 1,
            elements: [
                {
                    id: "annotation",
                    type: "text",
                    x: 0,
                    y: 0,
                    text: "edited",
                    zIndex: 1,
                    style: { color: "#ffffff", width: 1 },
                },
            ],
        };
        expect(resolveDirectStickerExportImageSrc(input)).toBeUndefined();
    });
});
