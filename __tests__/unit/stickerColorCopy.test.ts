import { describe, expect, it } from "vitest";

import { formatRgbColor, parseHexColor } from "../../src/services/stickerEditing";

describe("sticker color copy helpers", () => {
    it("parses hex colors into rgb triples", () => {
        expect(parseHexColor("#22c55e")).toEqual({ r: 34, g: 197, b: 94 });
        expect(parseHexColor("#ABCDEF")).toEqual({ r: 171, g: 205, b: 239 });
        expect(parseHexColor("not-a-color")).toBeUndefined();
    });

    it("formats rgb triples into a copy-ready string", () => {
        expect(formatRgbColor({ r: 34, g: 197, b: 94 })).toBe("rgb(34, 197, 94)");
    });
});
