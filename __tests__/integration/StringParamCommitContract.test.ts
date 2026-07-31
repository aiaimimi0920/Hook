import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("String parameter commit contract", () => {
    it("publishes single-line drafts as non-final and commits only on Enter or blur", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src", "components", "params", "controls", "StringControl.tsx"),
            "utf8",
        );

        expect(source).toContain("createSignal");
        expect(source).toContain("commitDraft");
        expect(source).toContain("onInput={(e) =>");
        expect(source).not.toContain("onInput={(e) => props.onChange(e.currentTarget.value)}");
        const inputHandler = source.slice(source.indexOf("onInput={(e) =>"), source.indexOf("onBlur={commitDraft}"));
        expect(inputHandler).toContain("props.onChange(next, false)");
        expect(inputHandler).not.toContain("props.onChange(next, true)");
        expect(source).toContain("stopInteractiveEvent");
        expect(source).toContain('event.key === "Enter"');
        expect(source).toContain("onBlur={commitDraft}");
        expect(source).toContain("props.onChange(next, true)");
        expect(source).not.toContain("if (next !== props.value)");
    });

    it("initializes the multiline text editor from the effective panel value", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src", "components", "UnitParamsPanel.tsx"),
            "utf8",
        );

        expect(source).toContain("const openTextEditor = (param: ArtParam) => {");
        expect(source).toContain('setTempText(String(getParamValue(param.id, param.default) ?? ""));');
        expect(source).toContain("onEditStart={() => openTextEditor(param)}");
        expect(source).not.toContain("onEditStart={() => setEditingTextId(param.id)}");
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
