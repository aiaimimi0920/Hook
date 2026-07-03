import { describe, expect, it } from "vitest";

import {
    buildLineMeasurementBadge,
    buildMeasurementBadge,
    buildShapeMeasurementBadge,
    formatLineMeasurement,
    formatShapeMeasurement,
} from "../../src/services/stickerMeasurements";

describe("sticker measurement badges", () => {
    it("formats bounded region measurements as width by height", () => {
        expect(formatShapeMeasurement("shape-rect", { x: 10, y: 12, w: 20.3, h: 29.6 })).toBe("20 x 30");
        expect(formatShapeMeasurement("crop", { x: 0, y: 0, w: 80, h: 45 })).toBe("80 x 45");
        expect(formatShapeMeasurement("mosaic", { x: 0, y: 0, w: 32, h: 18 })).toBe("32 x 18");
        expect(formatShapeMeasurement("blur", { x: 0, y: 0, w: 32, h: 18 })).toBe("32 x 18");
    });

    it("formats circular ellipse measurements as radius and non-circular ellipses as bounds", () => {
        expect(formatShapeMeasurement("shape-ellipse", { x: 0, y: 0, w: 30, h: 30 })).toBe("r = 15");
        expect(formatShapeMeasurement("shape-ellipse", { x: 0, y: 0, w: 40, h: 24 })).toBe("40 x 24");
    });

    it("formats line measurements from the first point to the latest endpoint", () => {
        expect(formatLineMeasurement([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe("L = 5");
        expect(formatLineMeasurement([{ x: 10, y: 10 }])).toBeNull();
    });

    it("places badges near the top-left anchor while keeping them inside sticker bounds", () => {
        const normal = buildMeasurementBadge("20 x 30", { x: 30, y: 40 }, { w: 120, h: 80 });
        expect(normal.y).toBeLessThan(40);
        expect(normal.x).toBe(30);

        const edge = buildMeasurementBadge("20 x 30", { x: 2, y: 2 }, { w: 120, h: 80 });
        expect(edge.x).toBeGreaterThanOrEqual(4);
        expect(edge.y).toBeGreaterThanOrEqual(4);
        expect(edge.x + edge.width).toBeLessThanOrEqual(116);
        expect(edge.y + edge.height).toBeLessThanOrEqual(76);
    });

    it("builds shape and line badge models with the final label", () => {
        expect(
            buildShapeMeasurementBadge(
                "shape-ellipse",
                { x: 12, y: 22, w: 36, h: 36 },
                { w: 160, h: 120 },
            )?.label,
        ).toBe("r = 18");

        expect(
            buildLineMeasurementBadge(
                [
                    { x: 10, y: 10 },
                    { x: 70, y: 10 },
                ],
                { w: 160, h: 120 },
            )?.label,
        ).toBe("L = 60");
    });
});
