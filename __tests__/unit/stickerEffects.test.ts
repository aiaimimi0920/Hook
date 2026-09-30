import { describe, expect, it } from "vitest";

import {
    computeEffectSourceProjection,
    paintMosaicGrid,
} from "../../src/services/stickerEffects";

describe("stickerEffects", () => {
    it("maps effect rect directly into cropped source coordinates when cropRect exists", () => {
        expect(
            computeEffectSourceProjection(
                { x: 20, y: 10, w: 40, h: 30 },
                { w: 120, h: 80 },
                { w: 300, h: 200 },
                {
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
                {},
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

    it("renders mosaic as an opaque privacy pattern instead of resampling readable source pixels", () => {
        const calls: Array<[string, ...unknown[]]> = [];
        const context = {
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
                paintMosaicGrid(context, 40, 20, 12, 4, 6),
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

    it("allows the mosaic grid to use the user-selected A/B colors", () => {
        const fills = new Set<string>();
        const context = {
            fillRect: () => {},
            set fillStyle(value: string) {
                fills.add(value);
            },
        } as unknown as CanvasRenderingContext2D;

        paintMosaicGrid(context, 40, 40, 10, 0, 0, ["#111111", "#eeeeee"]);

        expect(fills).toEqual(new Set(["#111111", "#eeeeee"]));
    });

    it("snaps exported mosaic cell fills to integer pixel bounds when the stroke box starts on fractional coordinates", () => {
        const fillRects: Array<[number, number, number, number]> = [];
        const context = {
            fillRect: (x: number, y: number, w: number, h: number) => {
                fillRects.push([x, y, w, h]);
            },
            set fillStyle(_value: string) {},
            get fillStyle() {
                return "";
            },
        } as unknown as CanvasRenderingContext2D;

        paintMosaicGrid(context, 43, 27, 12, 5.5, 3.25);

        expect(fillRects.length).toBeGreaterThan(0);
        expect(
            fillRects.every(([x, y, w, h]) =>
                Number.isInteger(x)
                && Number.isInteger(y)
                && Number.isInteger(w)
                && Number.isInteger(h),
            ),
        ).toBe(true);
        // Every output pixel must be covered, including fractional-origin seams.
        for (let y = 0; y < 27; y += 1) {
            for (let x = 0; x < 43; x += 1) {
                expect(fillRects.some(([left, top, width, height]) =>
                    x >= left && x < left + width && y >= top && y < top + height,
                )).toBe(true);
            }
        }
    });
});
