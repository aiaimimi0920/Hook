import { describe, expect, it } from "vitest";

import {
    clampLiveViewGeometry,
    initialLiveViewGeometry,
} from "../../src/services/liveCapture";

describe("live capture view geometry", () => {
    it("keeps the selected logical size unless the source exceeds the viewport", () => {
        expect(initialLiveViewGeometry(
            { width: 1920, height: 1080 },
            { width: 1280, height: 720 },
        )).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
        expect(initialLiveViewGeometry(
            { width: 50, height: 50 },
            { width: 1280, height: 720 },
        )).toEqual({ x: 24, y: 72, width: 50, height: 50 });
    });

    it("places a live view at the captured region and clamps it inside the viewport", () => {
        expect(initialLiveViewGeometry(
            { width: 50, height: 50 },
            { width: 1280, height: 720 },
            { x: 300, y: 200 },
        )).toEqual({ x: 300, y: 200, width: 50, height: 50 });
        expect(initialLiveViewGeometry(
            { width: 400, height: 200 },
            { width: 500, height: 300 },
            { x: 450, y: 280 },
        )).toEqual({ x: 100, y: 100, width: 400, height: 200 });
    });

    it("does not apply a device-pixel-ratio reduction to an in-viewport selection", () => {
        expect(initialLiveViewGeometry(
            { width: 800, height: 600 },
            { width: 1280, height: 720 },
            { x: 120, y: 80 },
        )).toEqual({ x: 120, y: 80, width: 800, height: 600 });
    });

    it("clamps move and resize operations to normal and narrow viewports", () => {
        expect(clampLiveViewGeometry(
            { x: -40, y: 900, width: 2_000, height: 120 },
            { width: 1_000, height: 700 },
        )).toEqual({ x: 0, y: 540, width: 1_000, height: 160 });

        expect(clampLiveViewGeometry(
            { x: 20, y: 20, width: 240, height: 160 },
            { width: 180, height: 120 },
        )).toEqual({ x: 0, y: 0, width: 180, height: 120 });
    });

    it("preserves the source aspect ratio when the chrome-free live view is resized", () => {
        expect(clampLiveViewGeometry(
            { x: 900, y: 600, width: 2_000, height: 1_000 },
            { width: 1_000, height: 700 },
            { width: 200, height: 100 },
        )).toEqual({ x: 0, y: 200, width: 1_000, height: 500 });
    });
});
