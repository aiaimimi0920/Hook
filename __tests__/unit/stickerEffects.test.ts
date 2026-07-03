import { describe, expect, it } from "vitest";

import {
    buildPrivacyMosaicTiles,
    computeEffectSourceProjection,
    computeMosaicPreviewCanvasSize,
    renderMosaicToCanvas,
} from "../../src/services/stickerEffects";

describe("stickerEffects", () => {
    it("maps effect rect directly into cropped source coordinates when cropRect exists", () => {
        expect(
            computeEffectSourceProjection(
                { x: 20, y: 10, w: 40, h: 30 },
                { w: 120, h: 80 },
                { w: 300, h: 200 },
                {
                    contentEraseStrokes: [],
                    cropRect: { x: 50, y: 25, w: 120, h: 80 },
                    sourceSize: { w: 300, h: 200 },
                },
            ),
        ).toEqual({
            sourceX: 70,
            sourceY: 35,
            sourceW: 40,
            sourceH: 30,
            destX: 0,
            destY: 0,
            destW: 40,
            destH: 30,
        });
    });

    it("maps uncropped effect rect through contain-fit projection and preserves dest clipping", () => {
        expect(
            computeEffectSourceProjection(
                { x: 10, y: 5, w: 80, h: 40 },
                { w: 120, h: 80 },
                { w: 60, h: 30 },
                {
                    contentEraseStrokes: [],
                },
            ),
        ).toEqual({
            sourceX: 5,
            sourceY: 0,
            sourceW: 40,
            sourceH: 17.5,
            destX: 0,
            destY: 5,
            destW: 80,
            destH: 35,
        });
    });

    it("caps mosaic preview canvas dimensions to avoid blocking pointer-drag rendering", () => {
        expect(
            computeMosaicPreviewCanvasSize({ w: 2400, h: 1200 }, 512),
        ).toEqual({
            width: 512,
            height: 256,
            scale: 512 / 2400,
        });

        expect(
            computeMosaicPreviewCanvasSize({ w: 320, h: 160 }, 512),
        ).toEqual({
            width: 320,
            height: 160,
            scale: 1,
        });
    });

    it("renders mosaic as an opaque privacy pattern instead of resampling readable source pixels", () => {
        const calls: Array<[string, ...unknown[]]> = [];
        const context = {
            save: () => calls.push(["save"]),
            restore: () => calls.push(["restore"]),
            beginPath: () => calls.push(["beginPath"]),
            rect: (...args: number[]) => calls.push(["rect", ...args]),
            clip: () => calls.push(["clip"]),
            fillRect: (...args: number[]) => calls.push(["fillRect", ...args]),
            set fillStyle(value: string) {
                calls.push(["fillStyle", value]);
            },
            get fillStyle() {
                return "";
            },
        } as unknown as CanvasRenderingContext2D;
        const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: {
                createElement: () => {
                    throw new Error("privacy mosaic must not create a sampling canvas");
                },
            },
        });

        try {
            expect(() =>
                renderMosaicToCanvas(
                    context,
                    {} as CanvasImageSource,
                    { sourceX: 0, sourceY: 0, sourceW: 40, sourceH: 20, destX: 4, destY: 6, destW: 40, destH: 20 },
                    12,
                ),
            ).not.toThrow();
        } finally {
            if (originalDocumentDescriptor) {
                Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
            } else {
                Reflect.deleteProperty(globalThis, "document");
            }
        }

        expect(calls.some(([name]) => name === "fillRect")).toBe(true);
        expect(calls.some(([name]) => name === "drawImage")).toBe(false);
        expect(
            calls
                .filter(([name]) => name === "fillStyle")
                .every(([, value]) => typeof value === "string" && value.startsWith("rgb(")),
        ).toBe(true);
    });

    it("covers fractional mosaic bounds so subpixel edges do not expose source pixels", () => {
        const tiles = buildPrivacyMosaicTiles({ x: 2.25, y: 3.5, w: 20.4, h: 12.2 }, 10);
        const coveredRight = Math.max(...tiles.map((tile) => tile.x + tile.w));
        const coveredBottom = Math.max(...tiles.map((tile) => tile.y + tile.h));

        expect(coveredRight).toBeGreaterThanOrEqual(22.65);
        expect(coveredBottom).toBeGreaterThanOrEqual(15.7);
    });

    it("allows mosaic privacy tiles to use the user-selected A/B colors", () => {
        const tiles = buildPrivacyMosaicTiles(
            { x: 0, y: 0, w: 40, h: 40 },
            10,
            ["#111111", "#eeeeee"],
        );
        const fills = new Set(tiles.map((tile) => tile.fill));

        expect(fills).toEqual(new Set(["#111111", "#eeeeee"]));
    });
});
