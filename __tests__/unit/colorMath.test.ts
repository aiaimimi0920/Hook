import { describe, expect, it } from "vitest";

import {
    hexToRgb,
    hsvToRgb,
    normalizeHexColor,
    rgbToHex,
    rgbToHsv,
} from "../../src/components/ColorPicker/colorMath";

describe("ColorPicker color math", () => {
    it("accepts only bounded hex colors or the transparent keyword", () => {
        expect(normalizeHexColor(" #AABBCC80 ")).toBe("#aabbcc80");
        expect(normalizeHexColor("transparent")).toBe("transparent");
        expect(normalizeHexColor("url(https://example.test/tracker.png)")).toBeNull();
        expect(hexToRgb("not-a-color")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    });

    it("clamps non-finite and out-of-range channel values", () => {
        expect(rgbToHex(Number.NaN, -10, 300, 2)).toBe("#0000ff");
        expect(hsvToRgb(420, 1, 1)).toEqual({ r: 255, g: 255, b: 0 });
        expect(hsvToRgb(Number.NaN, Number.POSITIVE_INFINITY, -1)).toEqual({
            r: 0,
            g: 0,
            b: 0,
        });
    });

    it("preserves ordinary RGB, HSV, and alpha conversions", () => {
        expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 });
        expect(rgbToHex(170, 187, 204, 128 / 255)).toBe("#aabbcc80");
        expect(hexToRgb("#aabbcc80")).toEqual({
            r: 170,
            g: 187,
            b: 204,
            a: 128 / 255,
        });
    });
});
