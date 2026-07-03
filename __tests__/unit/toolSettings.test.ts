import { describe, expect, it } from "vitest";

import { createDefaultStickerToolSettings } from "../../src/services/stickerEditing";
import { applyStickerToolSettingsPatch, normalizeStickerToolSettings } from "../../src/services/toolSettings";

describe("toolSettings per-tool presets", () => {
    it("keeps shape geometry settings isolated per shape tool", () => {
        let settings = createDefaultStickerToolSettings();

        settings = applyStickerToolSettingsPatch(settings, {
            domain: "create",
            mode: "shape-rect",
            activeTool: "shape-rect",
        });
        settings = applyStickerToolSettingsPatch(settings, {
            strokeWidth: 5,
            shapeSnapStep: 7,
            shapeCornerRadius: 11,
            shapeStrokeDashPattern: "dash-1",
            shapeConstrainSquare: true,
        });

        settings = applyStickerToolSettingsPatch(settings, {
            domain: "create",
            mode: "shape-triangle",
            activeTool: "shape-triangle",
        });
        expect(settings.strokeWidth).toBe(3);
        expect(settings.shapeSnapStep).toBe(0);
        expect(settings.shapeCornerRadius).toBe(0);
        expect(settings.shapeStrokeDashPattern).toBe("solid");
        expect(settings.shapeConstrainSquare).toBe(false);

        settings = applyStickerToolSettingsPatch(settings, {
            strokeWidth: 9,
            shapeSnapStep: 13,
            shapeCornerRadius: 4,
            shapeStrokeDashPattern: "dash-2",
            shapeConstrainSquare: false,
        });

        settings = applyStickerToolSettingsPatch(settings, {
            domain: "create",
            mode: "shape-rect",
            activeTool: "shape-rect",
        });
        expect(settings.strokeWidth).toBe(5);
        expect(settings.shapeSnapStep).toBe(7);
        expect(settings.shapeCornerRadius).toBe(11);
        expect(settings.shapeStrokeDashPattern).toBe("dash-1");
        expect(settings.shapeConstrainSquare).toBe(true);
    });

    it("keeps line, brush, and effect settings isolated across tool switches", () => {
        let settings = createDefaultStickerToolSettings();

        settings = applyStickerToolSettingsPatch(settings, {
            domain: "create",
            mode: "line",
            activeTool: "line",
        });
        settings = applyStickerToolSettingsPatch(settings, {
            strokeWidth: 8,
            shapeStrokeDashPattern: "dash-1",
            lineAngleSnap: true,
            lineArrowEnabled: true,
        });

        settings = applyStickerToolSettingsPatch(settings, {
            domain: "create",
            mode: "brush",
            activeTool: "brush",
        });
        expect(settings.strokeWidth).toBe(3);
        expect(settings.shapeStrokeDashPattern).toBe("solid");
        expect(settings.shapeSnapStep).toBe(0);
        expect(settings.brushHighlighterEnabled).toBe(false);

        settings = applyStickerToolSettingsPatch(settings, {
            strokeWidth: 6,
            shapeStrokeDashPattern: "dash-2",
            shapeSnapStep: 5,
            brushHighlighterEnabled: true,
        });

        settings = applyStickerToolSettingsPatch(settings, {
            domain: "create",
            mode: "mosaic",
            activeTool: "mosaic",
        });
        expect(settings.effectBrushSize).toBe(28);
        expect(settings.mosaicSize).toBe(12);

        settings = applyStickerToolSettingsPatch(settings, {
            effectBrushSize: 44,
            mosaicSize: 20,
        });

        settings = applyStickerToolSettingsPatch(settings, {
            domain: "create",
            mode: "blur",
            activeTool: "blur",
        });
        expect(settings.effectBrushSize).toBe(28);
        expect(settings.blurStrength).toBe(8);

        settings = applyStickerToolSettingsPatch(settings, {
            effectBrushSize: 16,
            blurStrength: 22,
        });

        settings = applyStickerToolSettingsPatch(settings, {
            domain: "create",
            mode: "line",
            activeTool: "line",
        });
        expect(settings.strokeWidth).toBe(8);
        expect(settings.shapeStrokeDashPattern).toBe("dash-1");
        expect(settings.lineAngleSnap).toBe(true);
        expect(settings.lineArrowEnabled).toBe(true);

        settings = applyStickerToolSettingsPatch(settings, {
            domain: "create",
            mode: "brush",
            activeTool: "brush",
        });
        expect(settings.strokeWidth).toBe(6);
        expect(settings.shapeStrokeDashPattern).toBe("dash-2");
        expect(settings.shapeSnapStep).toBe(5);
        expect(settings.brushHighlighterEnabled).toBe(true);

        settings = applyStickerToolSettingsPatch(settings, {
            domain: "create",
            mode: "mosaic",
            activeTool: "mosaic",
        });
        expect(settings.effectBrushSize).toBe(44);
        expect(settings.mosaicSize).toBe(20);
    });

    it("migrates legacy shared values into all relevant tool presets on first normalize", () => {
        const normalized = normalizeStickerToolSettings({
            domain: "create",
            mode: "shape-triangle",
            activeTool: "shape-triangle",
            strokeWidth: 12,
            shapeSnapStep: 9,
            shapeCornerRadius: 6,
            shapeStrokeDashPattern: "dash-2",
            shapeConstrainSquare: true,
            effectBrushSize: 52,
            mosaicSize: 18,
            blurStrength: 14,
        });

        const rectSettings = applyStickerToolSettingsPatch(normalized, {
            domain: "create",
            mode: "shape-rect",
            activeTool: "shape-rect",
        });
        expect(rectSettings.strokeWidth).toBe(12);
        expect(rectSettings.shapeSnapStep).toBe(9);
        expect(rectSettings.shapeCornerRadius).toBe(6);
        expect(rectSettings.shapeStrokeDashPattern).toBe("dash-2");
        expect(rectSettings.shapeConstrainSquare).toBe(true);

        const lineSettings = applyStickerToolSettingsPatch(normalized, {
            domain: "create",
            mode: "line",
            activeTool: "line",
        });
        expect(lineSettings.strokeWidth).toBe(12);
        expect(lineSettings.shapeStrokeDashPattern).toBe("dash-2");

        const blurSettings = applyStickerToolSettingsPatch(normalized, {
            domain: "create",
            mode: "blur",
            activeTool: "blur",
        });
        expect(blurSettings.effectBrushSize).toBe(52);
        expect(blurSettings.blurStrength).toBe(14);

        const mosaicSettings = applyStickerToolSettingsPatch(normalized, {
            domain: "create",
            mode: "mosaic",
            activeTool: "mosaic",
        });
        expect(mosaicSettings.effectBrushSize).toBe(52);
        expect(mosaicSettings.mosaicSize).toBe(18);
    });
});
