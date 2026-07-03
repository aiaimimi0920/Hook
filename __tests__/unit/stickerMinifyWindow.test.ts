import { describe, expect, it } from "vitest";

import {
    computeMinifiedStickerAnnotationViewport,
    computeMinifiedStickerViewport,
    computeMinifiedStickerWindow,
    computeRestoredMinifiedStickerWindow,
} from "../../src/services/stickerEditing";

describe("sticker minify window", () => {
    it("keeps the double-clicked point stationary by offsetting the sticker frame around the clicked location", () => {
        const result = computeMinifiedStickerWindow(
            { x: 100, y: 200, w: 300, h: 200 },
            0.5,
            0.25,
        );

        expect(result.savedRect).toEqual({ x: 100, y: 200, w: 300, h: 200 });
        expect(result.cropOffset).toEqual({ x: 100, y: 0 });
        expect(result.frame).toEqual({ x: 200, y: 200, w: 100, h: 100 });
    });

    it("clamps relative inputs from the visual rect so clicks on outward borders still crop against the nearest visible edge", () => {
        const result = computeMinifiedStickerWindow(
            { x: 40, y: 60, w: 120, h: 80 },
            -0.2,
            1.4,
        );

        expect(result.cropOffset).toEqual({ x: -50, y: 30 });
        expect(result.frame).toEqual({ x: -10, y: 90, w: 100, h: 100 });
    });

    it("restores the full sticker around the mini sticker's current position when the mini sticker was moved after shrinking", () => {
        const restored = computeRestoredMinifiedStickerWindow(
            { x: 700, y: 500, w: 100, h: 100 },
            { x: 100, y: 200, w: 300, h: 200 },
            { x: 100, y: 0 },
        );

        expect(restored).toEqual({ x: 600, y: 500, w: 300, h: 200 });
    });

    it("falls back to the original saved rect when crop offset is unavailable", () => {
        const restored = computeRestoredMinifiedStickerWindow(
            { x: 700, y: 500, w: 100, h: 100 },
            { x: 100, y: 200, w: 300, h: 200 },
            undefined,
        );

        expect(restored).toEqual({ x: 100, y: 200, w: 300, h: 200 });
    });

    it("combines the existing manual crop with the mini crop so crop-then-minify still shows the currently visible sticker instead of the original full image", () => {
        const viewport = computeMinifiedStickerViewport(
            { w: 120, h: 80 },
            { x: 10, y: 5 },
            {
                cropRect: { x: 40, y: 20, w: 120, h: 80 },
                sourceSize: { w: 300, h: 240 },
            },
        );

        expect(viewport).toEqual({
            width: 300,
            height: 240,
            offsetX: 50,
            offsetY: 25,
        });
    });

    it("uses the saved visible sticker frame directly when no manual crop exists", () => {
        const viewport = computeMinifiedStickerViewport(
            { w: 120, h: 80 },
            { x: 10, y: 5 },
            undefined,
        );

        expect(viewport).toEqual({
            width: 120,
            height: 80,
            offsetX: 10,
            offsetY: 5,
        });
    });

    it("keeps annotation layers in the pre-minify visible sticker space so double-click zoom does not hide marker overlays", () => {
        const viewport = computeMinifiedStickerAnnotationViewport(
            { w: 100, h: 100 },
            { w: 120, h: 80 },
            { x: 10, y: 5 },
        );

        expect(viewport).toEqual({
            width: 120,
            height: 80,
            offsetX: 10,
            offsetY: 5,
        });
    });

    it("falls back to the current mini frame when the legacy sticker has no saved visible frame metadata", () => {
        const viewport = computeMinifiedStickerAnnotationViewport(
            { w: 100, h: 100 },
            undefined,
            { x: 10, y: 5 },
        );

        expect(viewport).toEqual({
            width: 100,
            height: 100,
            offsetX: 10,
            offsetY: 5,
        });
    });
});
