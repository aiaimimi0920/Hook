import { describe, expect, it } from "vitest";

import {
    annotationContainsPoint,
    buildArrowHeadPolygon,
    buildRoundedPolygonPath,
    findTopmostAnnotationAtPoint,
    getAnnotationGroupBounds,
    getArrowHeadAnchorSegment,
    translateAnnotation,
} from "../../src/services/stickerGeometry";
import type { StickerAnnotation } from "../../src/types/stickerEditing";

describe("stickerGeometry", () => {
    it("finds the topmost annotation under the cursor", () => {
        const annotations: StickerAnnotation[] = [
            {
                id: "a",
                type: "rect",
                zIndex: 1,
                x: 20,
                y: 20,
                w: 120,
                h: 80,
                style: { color: "#fff", width: 2, opacity: 1 },
            },
            {
                id: "b",
                type: "text",
                zIndex: 3,
                x: 40,
                y: 60,
                text: "Top",
                style: { color: "#fff", width: 2, opacity: 1 },
            },
        ];

        const hit = findTopmostAnnotationAtPoint(annotations, { x: 50, y: 55 });

        expect(hit?.id).toBe("b");
    });

    it("translates shape-like annotations by a delta", () => {
        const shape: StickerAnnotation = {
            id: "shape",
            type: "rect",
            zIndex: 1,
            x: 10,
            y: 20,
            w: 50,
            h: 40,
            style: { color: "#fff", width: 2, opacity: 1 },
        };

        expect(translateAnnotation(shape, 15, -5)).toMatchObject({
            x: 25,
            y: 15,
            w: 50,
            h: 40,
        });
    });

    it("translates polyline-like annotations point-by-point without mutating the source", () => {
        const line: StickerAnnotation = {
            id: "line",
            type: "arrow",
            zIndex: 1,
            points: [
                { x: 10, y: 20 },
                { x: 30, y: 40 },
            ],
            style: { color: "#fff", width: 2, opacity: 1 },
        };

        const translated = translateAnnotation(line, 5, 7);

        expect(translated.points).toEqual([
            { x: 15, y: 27 },
            { x: 35, y: 47 },
        ]);
        expect(line.points).toEqual([
            { x: 10, y: 20 },
            { x: 30, y: 40 },
        ]);
    });

    it("still uses annotationContainsPoint for hit-testing behavior", () => {
        const annotation: StickerAnnotation = {
            id: "shape",
            type: "ellipse",
            zIndex: 1,
            x: 40,
            y: 40,
            w: 80,
            h: 50,
            style: { color: "#fff", width: 2, opacity: 1 },
        };

        expect(annotationContainsPoint(annotation, { x: 80, y: 65 })).toBe(true);
        expect(annotationContainsPoint(annotation, { x: 10, y: 10 })).toBe(false);
    });

    it("uses the last meaningful segment for arrowhead orientation instead of tiny trailing jitter", () => {
        expect(
            getArrowHeadAnchorSegment([
                { x: 10, y: 20 },
                { x: 80, y: 20 },
                { x: 82, y: 21 },
            ]),
        ).toEqual({
            from: { x: 10, y: 20 },
            to: { x: 82, y: 21 },
        });
    });

    it("builds arrowhead polygon points aligned to the terminal segment direction", () => {
        const arrow = buildArrowHeadPolygon(
            [
                { x: 10, y: 20 },
                { x: 80, y: 20 },
            ],
            { headLength: 12, headWidth: 8 },
        );

        expect(arrow).toEqual([
            { x: 80, y: 20 },
            { x: 68, y: 24 },
            { x: 68, y: 16 },
        ]);
    });

    it("trims the visible arrow shaft back to the arrowhead base so no line protrudes past the tip", async () => {
        const geometry = await import("../../src/services/stickerGeometry");
        const getArrowShaftPoints = (
            geometry as unknown as {
                getArrowShaftPoints?: (
                    points: Array<{ x: number; y: number }>,
                    options?: { headLength?: number; minDistance?: number },
                ) => Array<{ x: number; y: number }>;
            }
        ).getArrowShaftPoints;

        expect(getArrowShaftPoints).toBeTypeOf("function");
        expect(
            getArrowShaftPoints?.(
                [
                    { x: 10, y: 20 },
                    { x: 80, y: 20 },
                ],
                { headLength: 12 },
            ),
        ).toEqual([
            { x: 10, y: 20 },
            { x: 68, y: 20 },
        ]);
    });

    it("builds a union bounds box for multiple selected annotations", () => {
        const annotations: StickerAnnotation[] = [
            {
                id: "a",
                type: "rect",
                zIndex: 1,
                x: 10,
                y: 20,
                w: 40,
                h: 30,
                style: { color: "#fff", width: 2, opacity: 1 },
            },
            {
                id: "b",
                type: "text",
                zIndex: 2,
                x: 80,
                y: 50,
                text: "Wide",
                fontSize: 20,
                style: { color: "#fff", width: 2, opacity: 1 },
            },
        ];

        expect(getAnnotationGroupBounds(annotations)).toEqual({
            x: 10,
            y: 20,
            w: 118,
            h: 50,
        });
    });

    it("builds rounded polygon SVG paths when corner radius is enabled", () => {
        const points = [
            { x: 20, y: 10 },
            { x: 40, y: 40 },
            { x: 10, y: 40 },
        ];

        expect(buildRoundedPolygonPath(points, 0)).toBe("M 20 10 L 40 40 L 10 40 Z");

        const rounded = buildRoundedPolygonPath(points, 8);
        expect(rounded).toContain("Q");
        expect(rounded.startsWith("M ")).toBe(true);
        expect(rounded.endsWith(" Z")).toBe(true);
    });
});
