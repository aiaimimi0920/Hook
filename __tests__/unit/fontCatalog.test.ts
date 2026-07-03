import { describe, expect, it } from "vitest";

import {
    COMMON_STICKER_FONT_FAMILIES,
    mergeStickerFontFamilies,
} from "../../src/services/fontCatalog";

describe("fontCatalog", () => {
    it("merges preset and installed fonts into one deduplicated sorted list", () => {
        const fonts = mergeStickerFontFamilies([
            "Consolas",
            "My Custom Font",
            "微软雅黑",
            "Arial",
            "My Custom Font",
        ]);

        expect(fonts[0]).toBe(COMMON_STICKER_FONT_FAMILIES[0]);
        expect(fonts).toContain("My Custom Font");
        expect(fonts).toContain("微软雅黑");
        expect(fonts.filter((font) => font === "Arial")).toHaveLength(1);
        expect(fonts.filter((font) => font === "My Custom Font")).toHaveLength(1);
    });
});
