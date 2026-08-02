import { describe, expect, it } from "vitest";
import {
    formatArtParamTextValue,
    parseArtParamTextValue,
} from "../../src/services/artParamTextValue";

describe("Art structured text parameters", () => {
    const jsonParam = { widget: "textarea", data_type: "json" };

    it("formats and restores object and array values as JSON", () => {
        const value = { mode: "test", tags: ["a", "b"] };
        const text = formatArtParamTextValue(jsonParam, value);

        expect(text).toContain('"mode": "test"');
        expect(parseArtParamTextValue(jsonParam, text)).toEqual({ ok: true, value });
    });

    it("rejects invalid JSON without converting it to a plain string", () => {
        const parsed = parseArtParamTextValue(jsonParam, "{invalid");

        expect(parsed.ok).toBe(false);
    });

    it("keeps path and plain text parameters as strings", () => {
        const pathParam = { widget: "path", data_type: "path" };

        expect(formatArtParamTextValue(pathParam, ".\\output")).toBe(".\\output");
        expect(parseArtParamTextValue(pathParam, ".\\next")).toEqual({
            ok: true,
            value: ".\\next",
        });
    });
});
