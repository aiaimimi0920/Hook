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
});
