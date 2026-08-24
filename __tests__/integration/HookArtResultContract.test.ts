import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readLoomHookRustSources } from "../helpers/loomHookRustSources";

const source = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("formal Loom Hook Art result contract", () => {
  it("converts formal inline, shared-memory, and scalar port values into Hook deliveries", () => {
    const rustSource = readLoomHookRustSources();

    expect(rustSource).toContain('"inline_resource" =>');
    expect(rustSource).toContain('"shared_memory" =>');
    expect(rustSource).toContain('"value" =>');
    expect(rustSource).toContain('value["dataBase64"]');
    expect(rustSource).toContain('delivery.insert("candidates".to_owned(), candidates.clone())');
    expect(rustSource).not.toContain('"method": "art/process"');
  });

  it("turns formal failures into failed deliveries", () => {
    const rustSource = readLoomHookRustSources();

    expect(rustSource).toContain('"loom.hook.art.failure"');
    expect(rustSource).toContain("emit_formal_hook_failure");
    expect(rustSource).toContain("fn emit_art_error");
  });

  it("surfaces failed Art deliveries on the node", () => {
    const protocolSource = source("src/services/protocol.ts");
    const unitTypeSource = source("src/types/unit.ts");
    const appSource = source("src/app.tsx");
    const artDeliverySource = source("src/services/appArtDeliveryHandler.ts");
    const unitOverlaysSource = source("src/components/UnitVisualOverlays.tsx");
    const surfaceControllerSource = source("src/components/unitSurfaceController.ts");

    expect(protocolSource).toContain("error?: string");
    expect(unitTypeSource).toContain("errorMessage?: string");
    expect(appSource).toContain("createAppArtDeliveryHandler(propagateFromUnit)");
    expect(artDeliverySource).toMatch(/nodeStatus:\s*"error"[\s\S]*errorMessage:\s*delivery\.error/);
    expect(artDeliverySource).toMatch(/nodeStatus:\s*"completed"[\s\S]*errorMessage:\s*undefined/);
    expect(unitOverlaysSource).toContain("执行失败");
    expect(surfaceControllerSource).toContain("errorMessage");
  });
});
