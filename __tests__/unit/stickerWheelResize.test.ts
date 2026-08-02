import { describe, expect, it } from "vitest";

import {
    computeCroppedStickerImageViewport,
    computeStickerWheelResizeFrame,
} from "../../src/services/stickerEditing";

describe("sticker wheel resize", () => {
    it("zooms in and out while keeping the pointer anchored to the same image position", () => {
        const frame = { x: 100, y: 50, w: 200, h: 100 };
        const pointer = { x: 150, y: 75 };

        const zoomedIn = computeStickerWheelResizeFrame(frame, pointer, -120);
        const zoomedOut = computeStickerWheelResizeFrame(frame, pointer, 120);

        expect(zoomedIn.w).toBeGreaterThan(frame.w);
        expect(zoomedIn.h).toBeGreaterThan(frame.h);
        expect(zoomedOut.w).toBeLessThan(frame.w);
        expect(zoomedOut.h).toBeLessThan(frame.h);

        const sourceRatioX = (pointer.x - frame.x) / frame.w;
        const sourceRatioY = (pointer.y - frame.y) / frame.h;
        expect((pointer.x - zoomedIn.x) / zoomedIn.w).toBeCloseTo(sourceRatioX);
        expect((pointer.y - zoomedIn.y) / zoomedIn.h).toBeCloseTo(sourceRatioY);
        expect((pointer.x - zoomedOut.x) / zoomedOut.w).toBeCloseTo(sourceRatioX);
        expect((pointer.y - zoomedOut.y) / zoomedOut.h).toBeCloseTo(sourceRatioY);
    });

    it("clamps both dimensions to the minimum size without moving the pointer anchor", () => {
        const frame = { x: 10, y: 20, w: 30, h: 30 };
        const pointer = { x: 25, y: 35 };

        const resized = computeStickerWheelResizeFrame(frame, pointer, 10_000);

        expect(resized).toEqual({ x: 13, y: 23, w: 24, h: 24 });
        expect((pointer.x - resized.x) / resized.w).toBeCloseTo(0.5);
        expect((pointer.y - resized.y) / resized.h).toBeCloseTo(0.5);
    });

    it("scales a cropped image source and crop offset with the resized sticker frame", () => {
        const viewport = computeCroppedStickerImageViewport(
            { w: 200, h: 100 },
            {
                cropRect: { x: 20, y: 10, w: 100, h: 50 },
                sourceSize: { w: 400, h: 300 },
            },
        );

        expect(viewport).toEqual({
            width: 800,
            height: 600,
            offsetX: 40,
            offsetY: 20,
        });
    });

    it("does not synthesize a cropped viewport without complete crop metadata", () => {
        expect(computeCroppedStickerImageViewport({ w: 200, h: 100 }, undefined)).toBeNull();
        expect(
            computeCroppedStickerImageViewport(
                { w: 200, h: 100 },
                {
                    cropRect: { x: 20, y: 10, w: 0, h: 50 },
                    sourceSize: { w: 400, h: 300 },
                },
            ),
        ).toBeNull();
    });
});
