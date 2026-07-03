import { describe, expect, it } from "vitest";
import {
    getScaleGizmoHandleRects,
    getAnnotationCornerRadius,
    getVisibleFill,
    getVisibleStroke,
    isBoundedBoxMode,
    isMeasuredLineMode,
    isRegularShapeMode,
    isStraightLineMode,
    normalizeRect,
    resolveMoveGizmoAxisAtPoint,
    resolveScaleGizmoAxisAtPoint,
} from "../../src/components/stickerAnnotationModel";
import type { StickerShapeAnnotation } from "../../src/types/stickerEditing";

describe("sticker annotation model helpers", () => {
    it("classifies bounded, regular, and line-like draft modes", () => {
        expect(isBoundedBoxMode("crop")).toBe(true);
        // Mosaic/blur are freehand brush strokes now, not bounded-box draws.
        expect(isBoundedBoxMode("shape-rect")).toBe(true);
        expect(isRegularShapeMode("shape-rect")).toBe(true);
        expect(isRegularShapeMode("crop")).toBe(false);

        expect(isStraightLineMode("line")).toBe(true);
        expect(isStraightLineMode("brush")).toBe(true);
        expect(isMeasuredLineMode("line")).toBe(true);
        expect(isMeasuredLineMode("brush")).toBe(false);
    });

    it("normalizes drag rectangles regardless of drag direction", () => {
        expect(normalizeRect({ x: 40, y: 50 }, { x: 10, y: 20 })).toEqual({
            x: 10,
            y: 20,
            w: 30,
            h: 30,
        });
    });

    it("maps transparent stroke/fill settings to render-safe values", () => {
        expect(getVisibleStroke("#ff0000", 2)).toBe("#ff0000");
        expect(getVisibleStroke("#ff0000", 0)).toBe("none");
        expect(getVisibleStroke("transparent", 2)).toBe("none");
        expect(getVisibleFill("#00ff00")).toBe("#00ff00");
        expect(getVisibleFill("transparent")).toBe("transparent");
        expect(getVisibleFill(undefined)).toBe("transparent");
    });

    it("uses explicit corner radius first and round-rect defaults otherwise", () => {
        const baseShape: StickerShapeAnnotation = {
            id: "shape-1",
            type: "round-rect",
            x: 0,
            y: 0,
            w: 40,
            h: 20,
            zIndex: 1,
            style: { color: "#fff", width: 2 },
        };

        expect(getAnnotationCornerRadius(baseShape)).toBe(12);
        expect(getAnnotationCornerRadius({ ...baseShape, style: { ...baseShape.style, cornerRadius: 6 } })).toBe(6);
        expect(getAnnotationCornerRadius({ ...baseShape, type: "rect" })).toBe(0);
    });

    it("resolves move gizmo axis hits so move mode supports free XY drag plus explicit X/Y handles", () => {
        expect(typeof resolveMoveGizmoAxisAtPoint).toBe("function");

        const center = { x: 100, y: 100 };
        expect(resolveMoveGizmoAxisAtPoint({ x: 100, y: 100 }, center)).toBe("xy");
        expect(resolveMoveGizmoAxisAtPoint({ x: 132, y: 100 }, center)).toBe("x");
        expect(resolveMoveGizmoAxisAtPoint({ x: 100, y: 68 }, center)).toBe("y");
        expect(resolveMoveGizmoAxisAtPoint({ x: 145, y: 145 }, center)).toBeNull();
    });

    it("resolves scale gizmo axis hits from dedicated X/Y scale handles instead of reusing move-mode axes", () => {
        expect(typeof getScaleGizmoHandleRects).toBe("function");
        expect(typeof resolveScaleGizmoAxisAtPoint).toBe("function");

        const center = { x: 100, y: 100 };
        const handles = getScaleGizmoHandleRects(center);

        expect(resolveScaleGizmoAxisAtPoint({ x: center.x, y: center.y }, center)).toBe("xy");
        expect(
            resolveScaleGizmoAxisAtPoint(
                { x: handles.x.x + handles.x.w / 2, y: handles.x.y + handles.x.h / 2 },
                center,
            ),
        ).toBe("x");
        expect(
            resolveScaleGizmoAxisAtPoint(
                { x: handles.y.x + handles.y.w / 2, y: handles.y.y + handles.y.h / 2 },
                center,
            ),
        ).toBe("y");
        expect(resolveScaleGizmoAxisAtPoint({ x: 145, y: 145 }, center)).toBeNull();
    });
});
