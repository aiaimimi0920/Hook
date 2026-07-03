import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("UnitParamsPanel grouped scrolling contract", () => {
    it("keeps large art parameter panels bounded and scrolls only the parameter list", () => {
        const source = readFileSync(resolve(process.cwd(), "src", "components", "UnitParamsPanel.tsx"), "utf8");

        expect(source).toContain("buildArtParamGroups");
        expect(source).toContain("shouldGroupArtParams");
        expect(source).toContain("data-param-group");
        expect(source).toContain("data-param-group-header");
        expect(source).toContain("param-scroll-container");
        expect(source).toContain('"max-height": "min(560px, calc(100vh - 96px))"');
        expect(source).toContain('"overflow-y": "auto"');
        expect(source).toContain('"max-height": "min(360px, calc(100vh - 300px))"');
    });

    it("uses non-collapsing group labels so every parameter control stays editable", () => {
        const source = readFileSync(resolve(process.cwd(), "src", "components", "UnitParamsPanel.tsx"), "utf8");

        expect(source).not.toContain("toggleParamGroupExpanded");
        expect(source).not.toContain("globalParamGroupExpandedRegistry");
        expect(source).not.toContain("<Show when={isParamGroupExpanded(group)}");
        expect(source).toContain("<For each={group.params}>{(param) => renderParamControl(param)}</For>");
    });

    it("extends ArtParam with optional group metadata for future art definitions", () => {
        const protocolSource = readFileSync(resolve(process.cwd(), "src", "services", "protocol.ts"), "utf8");

        expect(protocolSource).toContain("group?: string");
    });

    it("defines a visible scrollbar style for the grouped parameter list", () => {
        const cssSource = readFileSync(resolve(process.cwd(), "src", "app.css"), "utf8");

        expect(cssSource).toContain(".param-scroll-container");
        expect(cssSource).toContain(".param-scroll-container::-webkit-scrollbar");
        expect(cssSource).toContain("scrollbar-color");
    });

    it("passes the reactive parameter store into UnitParamsPanel", () => {
        const unitViewSource = readFileSync(resolve(process.cwd(), "src", "components", "UnitView.tsx"), "utf8");

        expect(unitViewSource).toContain("params={props.params}");
        expect(unitViewSource).not.toContain("params={props.unit.params}");
    });

    it("keeps slider params editable with a slider plus a numeric stepper field", () => {
        const controlSource = readFileSync(
            resolve(process.cwd(), "src", "components", "params", "controls", "NumberControl.tsx"),
            "utf8",
        );
        const dispatcherSource = readFileSync(
            resolve(process.cwd(), "src", "components", "params", "UnitParamControl.tsx"),
            "utf8",
        );

        expect(dispatcherSource).toContain('widget={props.param.widget as "slider" | "number"}');
        expect(controlSource).toContain('props.widget === "slider"');
        expect(controlSource).toContain('type="range"');
        expect(controlSource).toContain('data-param-number-input');
        expect(controlSource).toContain('data-param-step-down');
        expect(controlSource).toContain('data-param-step-up');
        expect(controlSource).not.toContain("appearance-textfield");
    });

    it("lays slider params out in two rows so the range track fits the narrow floating panel", () => {
        const controlSource = readFileSync(
            resolve(process.cwd(), "src", "components", "params", "controls", "NumberControl.tsx"),
            "utf8",
        );

        expect(controlSource).toContain("data-param-slider-layout");
        expect(controlSource).toContain("data-param-value-row");
        expect(controlSource).toContain("data-param-slider-row");
        expect(controlSource).toContain('class="w-full min-w-0"');
        expect(controlSource).not.toContain("min-w-[72px]");
    });
});
