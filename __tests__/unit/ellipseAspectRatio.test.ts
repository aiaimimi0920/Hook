import { describe, expect, it } from "vitest";
import { resolveShapeAspectRatio } from "../../src/services/rectangleAspectRatio";
import { createDefaultStickerToolSettings } from "../../src/services/stickerEditing";
import { clampShapeRectToStickerBounds } from "../../src/services/stickerEditingGeometry";
import { applyStickerToolSettingsPatch, normalizeStickerToolSettings } from "../../src/services/toolSettings";

describe("ellipse aspect ratio", () => {
    it("uses the custom ratio and preserves Shift and other shape constraints", () => {
        const settings = { shapeAspectRatio: "16:9" };
        expect(resolveShapeAspectRatio("shape-ellipse", settings)).toBe(16 / 9);
        expect(resolveShapeAspectRatio("shape-ellipse", settings, true)).toBe(1);
        expect(resolveShapeAspectRatio("shape-triangle", settings)).toBe(1);
        expect(resolveShapeAspectRatio("shape-polygon", settings)).toBe(1);
        expect(resolveShapeAspectRatio("shape-ellipse", { shapeAspectRatio: "0:9" })).toBe(1);
    });

    it("keeps ellipse and rectangle ratios independent across switching and reload", () => {
        let settings = applyStickerToolSettingsPatch(createDefaultStickerToolSettings(), {
            activeTool: "shape-rect", mode: "shape-rect", domain: "create",
        });
        settings = applyStickerToolSettingsPatch(settings, { shapeAspectRatio: "4:3", shapeConstrainSquare: true });
        settings = applyStickerToolSettingsPatch(settings, { activeTool: "shape-ellipse", mode: "shape-ellipse" });
        expect(settings.shapeAspectRatio).toBe("1:1");
        settings = applyStickerToolSettingsPatch(settings, { shapeAspectRatio: "16:9", shapeConstrainSquare: true });
        settings = normalizeStickerToolSettings(settings);
        expect(settings.shapeAspectRatio).toBe("16:9");
        settings = applyStickerToolSettingsPatch(settings, { activeTool: "shape-rect", mode: "shape-rect" });
        expect(settings.shapeAspectRatio).toBe("4:3");
        settings = applyStickerToolSettingsPatch(settings, { activeTool: "shape-ellipse", mode: "shape-ellipse" });
        expect(settings.shapeAspectRatio).toBe("16:9");
        expect(settings.shapeConstrainSquare).toBe(true);
    });

    it("keeps the ellipse bounding box ratio when constrained by sticker edges", () => {
        const ratio = resolveShapeAspectRatio("shape-ellipse", { shapeAspectRatio: "16:9" });
        const rect = clampShapeRectToStickerBounds({ x: 10, y: 10 }, { x: 900, y: 900 }, { w: 300, h: 200 }, true, undefined, ratio);
        expect(rect.w / rect.h).toBeCloseTo(16 / 9);
        expect(rect.x + rect.w).toBeLessThanOrEqual(300);
        expect(rect.y + rect.h).toBeLessThanOrEqual(200);
    });
});
