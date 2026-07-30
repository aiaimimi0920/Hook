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

    it("keeps slider params editable with an overlay-safe drag track plus a numeric stepper field", () => {
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
        expect(controlSource).toContain('data-param-slider-track');
        expect(controlSource).toContain('data-param-slider-thumb');
        expect(controlSource).toContain('startSliderDrag');
        expect(controlSource).toContain('onMouseDown={startSliderDrag}');
        expect(controlSource).not.toContain('pointer-events-none');
        expect(controlSource).toContain('data-param-number-input');
        expect(controlSource).toContain('data-param-step-down');
        expect(controlSource).toContain('data-param-step-up');
        expect(controlSource).not.toContain('type="range"');
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

    it("keeps in-flight slider values local and guards image hover previews against stale params", () => {
        const panelSource = readFileSync(resolve(process.cwd(), "src", "components", "UnitParamsPanel.tsx"), "utf8");

        expect(panelSource).toContain("const [draggingSlider, setDraggingSlider]");
        expect(panelSource).toContain("if (dragging && dragging.id === paramId) return dragging.value;");
        expect(panelSource).toContain('typeof currentVal === "number"');
        expect(panelSource).toContain("const hoveringDataUrlPreview = createMemo(() => {");
        expect(panelSource).toContain('typeof value === "string" && value.startsWith("data:")');
        expect(panelSource).toContain("previewSrc().length");
        expect(panelSource).not.toContain("props.params[hoveringParam()!].length");
    });

    it("implements overlay-safe manual wheel and scrollbar dragging for long parameter panels", () => {
        const panelSource = readFileSync(resolve(process.cwd(), "src", "components", "UnitParamsPanel.tsx"), "utf8");

        expect(panelSource).toContain("data-param-scrollbar-track");
        expect(panelSource).toContain("data-param-scrollbar-thumb");
        expect(panelSource).toContain("applyManualScrollDelta");
        expect(panelSource).toContain("startScrollThumbDrag");
        expect(panelSource).toContain("onWheel={(event) => {");
    });
});
