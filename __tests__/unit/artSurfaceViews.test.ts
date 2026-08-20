import { describe, expect, it } from "vitest";

import {
    applySurfaceViewToSnapshot,
    clearSurfaceViewCrop,
    computeSurfaceViewPresentation,
    computeSurfaceViewResetFrame,
    computeSurfaceViewWindowPresentation,
    normalizeSurfaceViews,
    resolveSurfaceView,
} from "../../src/services/artSurfaceViews";
import type { SurfacePackageManifest, SurfaceSnapshot } from "../../src/services/surfaceProtocol";

const surface: SurfacePackageManifest = {
    protocolVersion: "loom.surface.v1",
    apiVersion: "1.0",
    variants: [{ runtime: "javascript", entry: "surface/main.js" }],
    views: [
        { id: "full", label: "全视图", fullSize: { width: 960, height: 820 } },
        { id: "price", label: "交易价格视图", fullSize: { width: 620, height: 620 } },
    ],
    defaultViewId: "full",
};

describe("Art Surface views", () => {
    it("resolves the selected view and falls back to the declared default", () => {
        expect(resolveSurfaceView(surface, "price")?.id).toBe("price");
        expect(resolveSurfaceView(surface, "missing")?.id).toBe("full");
    });

    it("drops invalid and duplicate developer view declarations", () => {
        expect(normalizeSurfaceViews({
            ...surface,
            views: [
                ...surface.views!,
                { id: "full", label: "duplicate", fullSize: { width: 1, height: 1 } },
                { id: "bad id", label: "invalid", fullSize: { width: 1, height: 1 } },
            ],
        }).map((view) => view.id)).toEqual(["full", "price"]);
    });

    it("resets a switched view to its full size while preserving the node center", () => {
        expect(computeSurfaceViewResetFrame(
            { x: 100, y: 200, w: 960, h: 820 },
            surface.views![1],
        )).toEqual({ x: 270, y: 300, w: 620, h: 620 });
    });

    it("uses one uniform content scale so text and graphics zoom together", () => {
        expect(computeSurfaceViewPresentation(
            { w: 480, h: 410 },
            surface.views![0],
        )).toEqual({
            logicalWidth: 960,
            logicalHeight: 820,
            scale: 0.5,
            left: 0,
            top: 0,
        });
    });

    it("keeps the complete Surface mounted behind a persistent host crop", () => {
        expect(computeSurfaceViewWindowPresentation(
            { w: 300, h: 200 },
            surface.views![0],
            {
                imageEditState: {
                    sourceSize: { w: 960, h: 820 },
                    cropRect: { x: 100, y: 50, w: 300, h: 200 },
                },
            },
        )).toEqual({
            logicalWidth: 960,
            logicalHeight: 820,
            scale: 1,
            left: -100,
            top: -50,
        });
    });

    it("uses the ordinary compact crop window without shrinking the whole Surface", () => {
        expect(computeSurfaceViewWindowPresentation(
            { w: 100, h: 100 },
            surface.views![0],
            {
                minified: true,
                savedRect: { w: 480, h: 410 },
                cropOffset: { x: 120, y: 80 },
            },
        )).toEqual({
            logicalWidth: 960,
            logicalHeight: 820,
            scale: 0.5,
            left: -120,
            top: -80,
        });
    });

    it("clears only the host crop when a different Surface view is selected", () => {
        expect(clearSurfaceViewCrop({
            contentEraseStrokes: [],
            flippedX: true,
            cropRect: { x: 10, y: 20, w: 300, h: 200 },
            sourceSize: { w: 960, h: 820 },
        })).toEqual({
            contentEraseStrokes: [],
            flippedX: true,
            cropRect: undefined,
            sourceSize: undefined,
        });
    });

    it("projects the host-selected view into the runtime snapshot", () => {
        const snapshot = {
            protocolVersion: "loom.surface.v1",
            instanceId: "instance:one",
            attachmentId: "attachment:one",
            artId: "stock",
            artVersion: "1.0.0",
            revision: 1,
            scene: { id: "root", type: "view" },
        } satisfies SurfaceSnapshot;

        expect(applySurfaceViewToSnapshot(snapshot, surface.views![1]).viewId).toBe("price");
        expect(snapshot).not.toHaveProperty("viewId");
    });
});
