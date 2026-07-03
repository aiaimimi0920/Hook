import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook link propagation contract", () => {
  it("re-propagates from the source unit after a new link is dropped", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");
    const linkingSource = readFileSync(resolve(process.cwd(), "src", "hooks", "useLinking.ts"), "utf8");

    expect(linkingSource).toContain("interface UseLinkingOptions");
    expect(linkingSource).toContain("onLinkCreated?:");
    expect(linkingSource).toContain("options.onLinkCreated?.(sourceId, targetUnitId, targetPortId)");

    expect(appSource).toContain("useLinking({");
    expect(appSource).toContain("onLinkCreated: (sourceId) =>");
    expect(appSource).toContain("propagateFromUnit(sourceId)");
  });

  it("triggers the downstream target port instead of an arbitrary first parameter", () => {
    const actionsSource = readFileSync(resolve(process.cwd(), "src", "hooks", "useUnitActions.ts"), "utf8");

    expect(actionsSource).toContain("const targetParam = l.toPortId || \"input\"");
    expect(actionsSource).toContain("handleParamChange(childId, targetParam, val, true, \"upstream\")");
    expect(actionsSource).not.toContain("const firstParam = Object.keys(childUnit.params || {})[0] || \"init\"");
    expect(actionsSource).not.toContain("handleParamChange(childId, firstParam, val, true, \"upstream\")");
  });
});
