import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook add-node action menu contract", () => {
  it("closes the Shift+1 add-node menu after creating an art node", () => {
    const canvasUnitsSource = readFileSync(resolve(process.cwd(), "src", "components", "CanvasUnits.tsx"), "utf8");
    const uiStoreSource = readFileSync(resolve(process.cwd(), "src", "store", "uiStore.ts"), "utf8");

    expect(uiStoreSource).toContain("closeActions: (id: string)");
    expect(canvasUnitsSource).toContain("uiActions.closeActions(u.id)");
    expect(canvasUnitsSource).toMatch(/props\.onAddNode\(u\.id,\s*artId\)[\s\S]*uiActions\.closeActions\(u\.id\)/);
  });

  it("constructs selected workflow Arts from their capability instead of empty node shells", () => {
    const unitActionsSource = readFileSync(resolve(process.cwd(), "src", "hooks", "useUnitActions.ts"), "utf8");

    expect(unitActionsSource).toContain("buildStandaloneArtNodeUnit");
    expect(unitActionsSource).toContain("getPrimaryImageInputPort(canonicalArtId)");
    expect(unitActionsSource).toContain("art-node-create-blocked-missing-capability");
    expect(unitActionsSource).not.toMatch(/const node = capability\s*\?/);
    expect(unitActionsSource).not.toMatch(/params:\s*\{\},\s*inputs:\s*\[\],\s*outputs:\s*\[\]/);
  });
});
