import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
    resolve(process.cwd(), "src/components/ColorPicker.tsx"),
    "utf8",
);

describe("ColorPicker external-value sync contract", () => {
    it("re-syncs the internal HSV state whenever the parent value changes", () => {
        expect(source).toContain("const syncFromExternalValue = (nextValue: string) => {");
        expect(source).toContain("syncFromExternalValue(props.value);");
        expect(source).toContain("if (!untrack(hexEditing)) {");
        expect(source).toContain("setHexDraft(nextValue);");
    });
});
