import { describe, expect, it } from "vitest";

import {
    BEAUTIFY_BACKGROUNDS,
    computeBeautifyLayout,
    createDefaultBeautifyState,
    paintBeautifyBackground,
    resolveBeautifyBackground,
} from "../../src/services/stickerBeautify";

describe("beautify layout", () => {
    it("pads the inner content equally on all sides", () => {
        const layout = computeBeautifyLayout(200, 100, 40);
        expect(layout).toEqual({
            outerWidth: 280,
            outerHeight: 180,
            innerX: 40,
            innerY: 40,
            innerWidth: 200,
            innerHeight: 100,
        });
    });

    it("clamps negative padding to zero and rounds fractional sizes", () => {
        const layout = computeBeautifyLayout(150.4, 80.6, -10);
        expect(layout.innerX).toBe(0);
        expect(layout.outerWidth).toBe(150);
        expect(layout.outerHeight).toBe(81);
    });
});

describe("beautify backgrounds", () => {
    it("falls back to the first preset for an unknown id", () => {
        expect(resolveBeautifyBackground("does-not-exist")).toBe(BEAUTIFY_BACKGROUNDS[0]);
    });

    it("default state is disabled with a valid preset", () => {
        const state = createDefaultBeautifyState();
        expect(state.enabled).toBe(false);
        expect(resolveBeautifyBackground(state.backgroundId).id).toBe(state.backgroundId);
    });

    it("paints a solid background with fillRect and a single color", () => {
        const calls: Array<[string, ...unknown[]]> = [];
        const context = {
            set fillStyle(value: unknown) {
                calls.push(["fillStyle", value]);
            },
            fillRect: (...args: number[]) => calls.push(["fillRect", ...args]),
            createLinearGradient: () => {
                throw new Error("solid background must not create a gradient");
            },
        } as unknown as CanvasRenderingContext2D;

        paintBeautifyBackground(context, resolveBeautifyBackground("white"), 100, 50);
        expect(calls).toContainEqual(["fillStyle", "#ffffff"]);
        expect(calls).toContainEqual(["fillRect", 0, 0, 100, 50]);
    });

    it("paints a gradient background with color stops at both ends", () => {
        const stops: Array<[number, string]> = [];
        const gradient = {
            addColorStop: (offset: number, color: string) => stops.push([offset, color]),
        };
        const calls: Array<[string, ...unknown[]]> = [];
        const context = {
            set fillStyle(value: unknown) {
                calls.push(["fillStyle", value]);
            },
            fillRect: (...args: number[]) => calls.push(["fillRect", ...args]),
            createLinearGradient: () => gradient,
        } as unknown as CanvasRenderingContext2D;

        const sunset = resolveBeautifyBackground("sunset");
        paintBeautifyBackground(context, sunset, 200, 100);
        expect(stops[0][0]).toBe(0);
        expect(stops[stops.length - 1][0]).toBe(1);
        expect(stops.map(([, color]) => color)).toEqual(sunset.colors);
        expect(calls).toContainEqual(["fillRect", 0, 0, 200, 100]);
    });
});
