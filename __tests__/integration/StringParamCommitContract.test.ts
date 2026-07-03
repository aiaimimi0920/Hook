import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("String parameter commit contract", () => {
    it("keeps single-line text edits as drafts and commits only on Enter or blur", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src", "components", "params", "controls", "StringControl.tsx"),
            "utf8",
        );

        expect(source).toContain("createSignal");
        expect(source).toContain("commitDraft");
        expect(source).toContain("onInput={(e) =>");
        expect(source).not.toContain("onInput={(e) => props.onChange(e.currentTarget.value)}");
        expect(source).toContain('event.key === "Enter"');
        expect(source).toContain("onBlur={commitDraft}");
        expect(source).toContain("props.onChange(next, true)");
        expect(source).not.toContain("if (next !== props.value)");
    });

    it("passes text commit finality through UnitParamControl instead of treating every draft as final", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src", "components", "params", "UnitParamControl.tsx"),
            "utf8",
        );

        const textBranch = source.match(/<Match when=\{props\.param\.widget === "text"\}>([\s\S]*?)<\/Match>/)?.[1] ?? "";
        expect(textBranch).toContain("onChange={(val, isFinal) => props.onChange(props.param.id, val, isFinal)}");
        expect(textBranch).not.toContain("onChange={(val) => props.onChange(props.param.id, val)}");
    });
});
