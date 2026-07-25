import { describe, expect, it } from "vitest";
import {
    isStickerSurfaceDoubleClickTarget,
    resolveStickerSurfaceDoubleClickTarget,
} from "../../src/services/stickerDoubleClick";

const targetClosestTo = (closestResult: unknown): EventTarget =>
    ({
        closest: (selector: string) => {
            expect(selector).toBe(".sticker-visual");
            return closestResult;
        },
    }) as unknown as EventTarget;

describe("sticker double-click target guard", () => {
    it("returns the closest sticker visual that belongs to the current unit container", () => {
        const stickerVisual = {};
        const container = {
            contains: (node: unknown) => node === stickerVisual,
        };

        expect(resolveStickerSurfaceDoubleClickTarget(targetClosestTo(stickerVisual), container)).toBe(stickerVisual);
    });

    it("allows double-click zoom only when the event target belongs to the sticker visual surface", () => {
        const stickerVisual = {};
        const container = {
            contains: (node: unknown) => node === stickerVisual,
        };

        expect(isStickerSurfaceDoubleClickTarget(targetClosestTo(stickerVisual), container)).toBe(true);
    });

    it("rejects toolbar/control double-clicks that are not inside the sticker visual surface", () => {
        const container = {
            contains: () => true,
        };

        expect(isStickerSurfaceDoubleClickTarget(targetClosestTo(null), container)).toBe(false);
    });

    it("rejects surfaces that do not belong to the current unit container", () => {
        const foreignStickerVisual = {};
        const container = {
            contains: () => false,
        };

        expect(resolveStickerSurfaceDoubleClickTarget(targetClosestTo(foreignStickerVisual), container)).toBeNull();
        expect(isStickerSurfaceDoubleClickTarget(targetClosestTo(foreignStickerVisual), container)).toBe(false);
    });

    it("rejects non-element event targets", () => {
        const container = {
            contains: () => true,
        };

        expect(resolveStickerSurfaceDoubleClickTarget({} as EventTarget, container)).toBeNull();
        expect(resolveStickerSurfaceDoubleClickTarget(null, container)).toBeNull();
        expect(isStickerSurfaceDoubleClickTarget({} as EventTarget, container)).toBe(false);
        expect(isStickerSurfaceDoubleClickTarget(null, container)).toBe(false);
    });
});
