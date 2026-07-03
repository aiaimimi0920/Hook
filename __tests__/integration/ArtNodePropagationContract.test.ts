import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook art-node upstream propagation contract", () => {
  it("treats upstream image propagation as a final upstream execution trigger", () => {
    const source = readFileSync(resolve(process.cwd(), "src", "hooks", "useUnitActions.ts"), "utf8");

    expect(source).toContain('const targetParam = l.toPortId || "input"');
    expect(source).toContain('handleParamChange(childId, targetParam, val, true, "upstream")');
    expect(source).not.toContain('handleParamChange(childId, firstParam, val, true, "upstream")');
  });

  it("respects upstream-driven execution toggles before triggering downstream art nodes", () => {
    const source = readFileSync(resolve(process.cwd(), "src", "hooks", "useUnitActions.ts"), "utf8");

    expect(source).toContain("triggerMode?.upstreamDriven");
    expect(source).toContain("propagation?.listenUpstream");
  });

  it("runs a newly spawned connected art node once after creating the source link", () => {
    const source = readFileSync(resolve(process.cwd(), "src", "hooks", "useUnitActions.ts"), "utf8");

    expect(source).toContain("propagateFromUnit(fromId)");
  });

  it("lets upstream triggers bypass param-driven throttling for non-shader cloud nodes", () => {
    const source = readFileSync(resolve(process.cwd(), "src", "hooks", "useNodeParameters.ts"), "utf8");

    expect(source).toContain('triggerSource: "param" | "upstream" | "manual" = "param"');
    expect(source).toContain('const isUpstreamTrigger = triggerSource === "upstream"');
    expect(source).toContain("if (isUpstreamTrigger)");
  });

  it("resolves art input images through intermediate sticker links before dispatching cloud nodes", () => {
    const nodeParametersSource = readFileSync(resolve(process.cwd(), "src", "hooks", "useNodeParameters.ts"), "utf8");
    const unitActionsSource = readFileSync(resolve(process.cwd(), "src", "hooks", "useUnitActions.ts"), "utf8");

    expect(nodeParametersSource).toContain("resolveUnitExecutionInputImage");
    expect(nodeParametersSource).toContain("unitId,");
    expect(unitActionsSource).toContain("resolveUnitImageFromGraph");
    expect(unitActionsSource).toContain("unitId: fromUnitId");
  });
});
