import { describe, expect, it, vi } from "vitest";

import { createStickerAnnotationPointerRuntime } from "../../src/components/stickerAnnotationPointerRuntime";
import type { ActiveTransformInteraction } from "../../src/components/stickerAnnotationTransformController";

const pointerEventAt = (clientX: number, clientY: number) =>
    ({ clientX, clientY } as PointerEvent);

describe("createStickerAnnotationPointerRuntime", () => {
    it("returns finite client coordinates when a late event arrives without a host", () => {
        const runtime = createStickerAnnotationPointerRuntime();

        expect(runtime.toLocalPoint(pointerEventAt(12, 34))).toEqual({ x: 12, y: 34 });
        expect(runtime.toLocalPoint(pointerEventAt(Number.NaN, Number.POSITIVE_INFINITY))).toEqual({
            x: 0,
            y: 0,
        });
    });

    it("does not create a pointer session when no host is bound", () => {
        const runtime = createStickerAnnotationPointerRuntime();

        expect(runtime.captureHostPointer(7)).toBe(false);
        expect(() => runtime.dispose()).not.toThrow();
    });

    it("restores existing SVG transforms after an imperative move preview", () => {
        const runtime = createStickerAnnotationPointerRuntime();
        const host = document.createElement("div");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const follower = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const selection = document.createElementNS("http://www.w3.org/2000/svg", "g");
        follower.dataset.stickerAnnotationId = "annotation-1";
        follower.setAttribute("transform", "rotate(15)");
        selection.setAttribute("transform", "scale(2)");
        svg.append(follower);
        host.append(svg);
        runtime.setHostRef(host);
        runtime.setSelectionOverlayRef(selection);
        runtime.prepareImperativeMovePreview(["annotation-1"]);
        const interaction = {
            kind: "move",
            annotationIds: ["annotation-1"],
            startPoint: { x: 1, y: 2 },
            currentPoint: { x: 1, y: 2 },
            baseAnnotations: [],
            pivotMode: "group",
            axis: "xy",
            pivot: { x: 0, y: 0 },
        } satisfies ActiveTransformInteraction;

        runtime.applyImperativeMovePreview(interaction, { x: 4, y: 8 });
        expect(follower.getAttribute("transform")).toBe("translate(3 6)");
        runtime.clearImperativeMovePreview();

        expect(follower.getAttribute("transform")).toBe("rotate(15)");
        expect(selection.getAttribute("transform")).toBe("scale(2)");
    });

    it("releases pointer capture defensively during disposal", () => {
        const runtime = createStickerAnnotationPointerRuntime();
        const host = document.createElement("div");
        Object.defineProperties(host, {
            setPointerCapture: { value: vi.fn() },
            hasPointerCapture: { value: vi.fn(() => true) },
            releasePointerCapture: { value: vi.fn() },
        });
        runtime.setHostRef(host);
        expect(runtime.captureHostPointer(9)).toBe(true);

        runtime.dispose();

        expect(host.releasePointerCapture).toHaveBeenCalledWith(9);
        expect(runtime.host()).toBeUndefined();
    });
});
