import { describe, expect, it } from "vitest";

import {
    clampCropRectToStickerBounds,
    clampShapeRectToStickerBounds,
    constrainLinearToolEndpoint,
    computeNextCropFrame,
    computeRestoredCropFrame,
    createContentEraserStroke,
    createDefaultStickerColorState,
    createDefaultStickerGroup,
    createDefaultStickerToolSettings,
    createEmptyAnnotationState,
    createEmptyImageEditState,
    getEffectiveStickerColor,
    nextSerialLabel,
} from "../../src/services/stickerEditing";
import {
    removeStickerGroup,
    toggleStickerGroupHidden,
    toggleStickerGroupLocked,
    upsertStickerGroup,
} from "../../src/services/stickerGroups";

describe("Hook sticker foundation helpers", () => {
    it("creates decision-complete defaults for local sticker editing", () => {
        expect(createDefaultStickerColorState()).toMatchObject({
            activeColor: "#ef4444",
        });
        expect(createDefaultStickerColorState().palette.length).toBeGreaterThanOrEqual(5);

        expect(createDefaultStickerToolSettings()).toMatchObject({
            mode: "select",
            strokeWidth: 3,
            textSize: 16,
            blurStrength: 8,
            mosaicSize: 12,
            contentEraserSize: 20,
            contentEraserOnlyAnnotations: false,
        });

        expect(createEmptyAnnotationState()).toEqual({
            elements: [],
            serialCounter: 1,
        });
        expect(createEmptyImageEditState()).toEqual({
            contentEraseStrokes: [],
        });
    });

    it("resolves content-eraser color from either the sampled screen color or the active fallback color", () => {
        expect(
            getEffectiveStickerColor(
                {
                    activeColor: "#ffffff",
                    sampledColor: "#123456",
                    palette: ["#ffffff"],
                },
                true,
            ),
        ).toBe("#123456");

        expect(
            getEffectiveStickerColor(
                {
                    activeColor: "#ffffff",
                    palette: ["#ffffff"],
                },
                true,
            ),
        ).toBe("#ffffff");
    });

    it("tracks serial numbering and content-eraser stroke scaffolding", () => {
        expect(nextSerialLabel({ elements: [], serialCounter: 4 })).toBe("4");
        expect(createContentEraserStroke("stroke-1", "#000000", 24, 1)).toEqual({
            id: "stroke-1",
            color: "#000000",
            width: 24,
            opacity: 1,
            points: [],
        });
    });

    it("supports group creation, update, hide/lock toggles, and removal", () => {
        const initial = [createDefaultStickerGroup("g-1", "Alpha")];
        const updated = upsertStickerGroup(initial, { id: "g-1", name: "Beta", hidden: false, locked: false });
        expect(updated).toEqual([{ id: "g-1", name: "Beta", hidden: false, locked: false }]);

        const appended = upsertStickerGroup(updated, createDefaultStickerGroup("g-2", "Gamma"));
        expect(appended).toHaveLength(2);

        const hidden = toggleStickerGroupHidden(appended, "g-2");
        expect(hidden.find((group) => group.id === "g-2")?.hidden).toBe(true);

        const locked = toggleStickerGroupLocked(hidden, "g-2");
        expect(locked.find((group) => group.id === "g-2")?.locked).toBe(true);

        expect(removeStickerGroup(locked, "g-1")).toEqual([
            { id: "g-2", name: "Gamma", hidden: true, locked: true },
        ]);
    });

    it("computes cumulative crop frames against the original sticker source coordinates", () => {
        expect(
            computeNextCropFrame(
                { x: 100, y: 200, w: 300, h: 240 },
                undefined,
                { x: 40, y: 20, w: 120, h: 80 },
            ),
        ).toEqual({
            unitRect: { x: 140, y: 220, w: 120, h: 80 },
            cropRect: { x: 40, y: 20, w: 120, h: 80 },
            sourceSize: { w: 300, h: 240 },
        });

        expect(
            computeNextCropFrame(
                { x: 140, y: 220, w: 120, h: 80 },
                {
                    cropRect: { x: 40, y: 20, w: 120, h: 80 },
                    sourceSize: { w: 300, h: 240 },
                },
                { x: 10, y: 5, w: 50, h: 30 },
            ),
        ).toEqual({
            unitRect: { x: 150, y: 225, w: 50, h: 30 },
            cropRect: { x: 50, y: 25, w: 50, h: 30 },
            sourceSize: { w: 300, h: 240 },
        });

        expect(
            computeRestoredCropFrame(
                { x: 150, y: 225, w: 50, h: 30 },
                {
                    cropRect: { x: 50, y: 25, w: 50, h: 30 },
                    sourceSize: { w: 300, h: 240 },
                },
            ),
        ).toEqual({
            x: 100,
            y: 200,
            w: 300,
            h: 240,
        });
    });

    it("clamps crop rectangles to the current sticker bounds so crop previews do not spill onto other layers", () => {
        expect(
            clampCropRectToStickerBounds(
                { x: 40, y: 20 },
                { x: 180, y: 120 },
                { w: 120, h: 80 },
            ),
        ).toEqual({
            x: 40,
            y: 20,
            w: 80,
            h: 60,
        });

        expect(
            clampCropRectToStickerBounds(
                { x: 60, y: 30 },
                { x: -20, y: -10 },
                { w: 120, h: 80 },
            ),
        ).toEqual({
            x: 0,
            y: 0,
            w: 60,
            h: 30,
        });
    });

    it("locks shape tools to squares and circles when shift is held while still respecting sticker bounds", () => {
        expect(
            clampShapeRectToStickerBounds(
                { x: 20, y: 10 },
                { x: 90, y: 30 },
                { w: 120, h: 80 },
                true,
            ),
        ).toEqual({
            x: 20,
            y: 10,
            w: 70,
            h: 70,
        });

        expect(
            clampShapeRectToStickerBounds(
                { x: 90, y: 60 },
                { x: 20, y: 10 },
                { w: 120, h: 80 },
                true,
            ),
        ).toEqual({
            x: 30,
            y: 0,
            w: 60,
            h: 60,
        });

        expect(
            clampShapeRectToStickerBounds(
                { x: 100, y: 20 },
                { x: 160, y: 70 },
                { w: 120, h: 80 },
                true,
            ),
        ).toEqual({
            x: 100,
            y: 20,
            w: 20,
            h: 20,
        });
    });

    it("snaps rectangle growth to 10px increments under ctrl using standard rounding", () => {
        expect(
            clampShapeRectToStickerBounds(
                { x: 20, y: 10 },
                { x: 44, y: 33 },
                { w: 120, h: 80 },
                false,
                10,
            ),
        ).toEqual({
            x: 20,
            y: 10,
            w: 20,
            h: 20,
        });

        expect(
            clampShapeRectToStickerBounds(
                { x: 20, y: 10 },
                { x: 45, y: 35 },
                { w: 120, h: 80 },
                false,
                10,
            ),
        ).toEqual({
            x: 20,
            y: 10,
            w: 30,
            h: 30,
        });

        expect(
            clampShapeRectToStickerBounds(
                { x: 100, y: 20 },
                { x: 160, y: 49 },
                { w: 120, h: 80 },
                false,
                10,
            ),
        ).toEqual({
            x: 100,
            y: 20,
            w: 20,
            h: 30,
        });
    });

    it("uses the same 10px step snapping math for round-rect and ellipse box geometry", () => {
        expect(
            clampShapeRectToStickerBounds(
                { x: 20, y: 10 },
                { x: 44, y: 35 },
                { w: 120, h: 80 },
                false,
                10,
            ),
        ).toEqual({
            x: 20,
            y: 10,
            w: 20,
            h: 30,
        });

        expect(
            clampShapeRectToStickerBounds(
                { x: 20, y: 10 },
                { x: 45, y: 35 },
                { w: 120, h: 80 },
                false,
                10,
            ),
        ).toEqual({
            x: 20,
            y: 10,
            w: 30,
            h: 30,
        });
    });

    it("locks line and arrow endpoints to axis-or-45deg with shift, and snaps them to 10px steps under ctrl", () => {
        expect(
            constrainLinearToolEndpoint(
                { x: 10, y: 10 },
                { x: 37, y: 23 },
            ),
        ).toEqual({
            x: 37,
            y: 23,
        });

        expect(
            constrainLinearToolEndpoint(
                { x: 10, y: 10 },
                { x: 40, y: 22 },
                { lockAngle: true },
            ),
        ).toEqual({
            x: 42.31098884280703,
            y: 10,
        });

        expect(
            constrainLinearToolEndpoint(
                { x: 10, y: 10 },
                { x: 33, y: 38 },
                { lockAngle: true },
            ),
        ).toEqual({
            x: 35.622255950637914,
            y: 35.62225595063791,
        });

        expect(
            constrainLinearToolEndpoint(
                { x: 10, y: 10 },
                { x: 34, y: 34 },
                { snapStep: 10 },
            ),
        ).toEqual({
            x: 30,
            y: 30,
        });

        expect(
            constrainLinearToolEndpoint(
                { x: 10, y: 10 },
                { x: 37, y: 23 },
                { snapStep: 10 },
            ),
        ).toEqual({
            x: 40,
            y: 20,
        });

        expect(
            constrainLinearToolEndpoint(
                { x: 10, y: 10 },
                { x: 37, y: 23 },
                { lockAngle: true, snapStep: 10 },
            ),
        ).toEqual({
            x: 30,
            y: 30,
        });
    });
});
