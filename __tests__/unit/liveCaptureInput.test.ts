import { describe, expect, it, vi } from "vitest";

import {
    liveMouseButton,
    liveNormalizedPoint,
    releaseLivePointer,
    tryCaptureLivePointer,
    liveVirtualKey,
    liveWheelPayload,
} from "../../src/services/liveCaptureInput";

describe("live capture input mapping", () => {
    it("maps and clamps local view coordinates to normalized source coordinates", () => {
        expect(liveNormalizedPoint(
            { left: 10, top: 20, width: 200, height: 100 },
            { width: 200, height: 100 },
            110,
            45,
        )).toEqual({ normalizedX: 0.5, normalizedY: 0.25 });
        expect(liveNormalizedPoint(
            { left: 10, top: 20, width: 200, height: 100 },
            { width: 200, height: 100 },
            -1_000,
            1_000,
        )).toBeUndefined();
        expect(liveNormalizedPoint(
            { left: 10, top: 20, width: 200, height: 100 },
            { width: 200, height: 100 },
            -1_000,
            1_000,
            true,
        )).toEqual({ normalizedX: 0, normalizedY: 1 });
    });

    it("excludes contain-fit letterboxing and maps only the rendered source box", () => {
        const viewport = { left: 0, top: 0, width: 400, height: 400 };
        const source = { width: 1600, height: 900 };

        expect(liveNormalizedPoint(viewport, source, 200, 50)).toBeUndefined();
        expect(liveNormalizedPoint(viewport, source, 200, 200)).toEqual({
            normalizedX: 0.5,
            normalizedY: 0.5,
        });
        expect(liveNormalizedPoint(viewport, source, 0, 200)).toEqual({
            normalizedX: 0,
            normalizedY: 0.5,
        });
    });

    it("maps every displayed pixel for the fill-fitted local live sticker", () => {
        const viewport = { left: 100, top: 50, width: 300, height: 200 };
        const physicalSource = { width: 1_200, height: 900 };

        expect(liveNormalizedPoint(
            viewport,
            physicalSource,
            100,
            50,
            false,
            "fill",
        )).toEqual({ normalizedX: 0, normalizedY: 0 });
        expect(liveNormalizedPoint(
            viewport,
            physicalSource,
            400,
            250,
            false,
            "fill",
        )).toEqual({ normalizedX: 1, normalizedY: 1 });
    });

    it("preserves button identity and chooses vertical or horizontal wheel edges", () => {
        expect([0, 1, 2, 3].map(liveMouseButton)).toEqual(["left", "middle", "right", undefined]);
        expect(liveWheelPayload({ deltaX: 3, deltaY: -40 })).toEqual({
            wheelAxis: "vertical",
            wheelDelta: 120,
        });
        expect(liveWheelPayload({ deltaX: 50, deltaY: 2 })).toEqual({
            wheelAxis: "horizontal",
            wheelDelta: -120,
        });
    });

    it("rejects keys outside the bounded Win32 virtual-key range", () => {
        expect(liveVirtualKey({ keyCode: 65 })).toBe(65);
        expect(liveVirtualKey({ keyCode: 0 })).toBeUndefined();
        expect(liveVirtualKey({ keyCode: 255 })).toBeUndefined();
    });

    it("does not let synthetic pointer capture failures block live control input", () => {
        const setPointerCapture = vi.fn(() => { throw new DOMException("synthetic pointer"); });
        expect(tryCaptureLivePointer({ setPointerCapture }, 1, false)).toBe(false);
        expect(setPointerCapture).not.toHaveBeenCalled();
        expect(tryCaptureLivePointer({ setPointerCapture }, 1, true)).toBe(false);

        const releasePointerCapture = vi.fn();
        releaseLivePointer({
            hasPointerCapture: () => true,
            releasePointerCapture,
        }, 1);
        expect(releasePointerCapture).toHaveBeenCalledWith(1);
    });
});
