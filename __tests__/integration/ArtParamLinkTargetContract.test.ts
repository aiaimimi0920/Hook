import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Art parameter link target contract", () => {
    it("lets parameter rows behave as input link targets for scalar and image-link params", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src", "components", "params", "UnitParamControl.tsx"),
            "utf8",
        );

        expect(source).toContain("onLinkDrop?:");
        expect(source).toContain("onLinkMove?:");
        expect(source).toContain("isLinked?:");
        expect(source).toContain("data-param-link-target");
        expect(source).toContain("data-port-name={props.param.id}");
        expect(source).toContain("props.onLinkDrop?.(props.param.id)");
        expect(source).toContain("props.onLinkMove?.(props.param.id, e)");
    });

    it("registers parameter-row link targets so canvas links can anchor to the floating panel", () => {
        const source = readFileSync(resolve(process.cwd(), "src", "components", "UnitParamsPanel.tsx"), "utf8");

        expect(source).toContain("isParamLinked");
        expect(source).toContain("registerLinkTarget={(el) => registerPanelPort(el, param.id)}");
        expect(source).toContain("onLinkDrop={props.onLinkDrop}");
        expect(source).toContain("onLinkMove={props.onLinkMove}");
    });

    it("treats image-link buttons as target drops instead of outgoing link starts", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src", "components", "params", "controls", "ImageControl.tsx"),
            "utf8",
        );

        expect(source).toContain("onLinkDrop?:");
        expect(source).toContain("onLinkMove?:");
        expect(source).toContain("props.onLinkDrop?.()");
        expect(source).toContain("props.onLinkMove?.(e)");
        expect(source).not.toContain("props.onLinkStart?.(e.clientX, e.clientY)");
    });
});
