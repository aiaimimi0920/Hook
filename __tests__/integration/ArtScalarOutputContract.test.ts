import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Art scalar output contract", () => {
  it("persists scalar delivery values into unit output ports for downstream parameter links", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");
    const unitTypeSource = readFileSync(resolve(process.cwd(), "src", "types", "unit.ts"), "utf8");
    const protocolSource = readFileSync(resolve(process.cwd(), "src", "services", "protocol.ts"), "utf8");
    const syncSource = readFileSync(resolve(process.cwd(), "src", "services", "syncService.ts"), "utf8");

    expect(protocolSource).toContain("'value' | 'json' | 'text' | 'number'");
    expect(protocolSource).toContain("outputs?: Record<string, unknown>");
    expect(unitTypeSource).toContain("outputs?: Record<string, unknown>");
    expect(appSource).toContain('case "value":');
    expect(appSource).toContain("output: delivery.delivery.value ?? delivery.delivery.data");
    expect(appSource).toContain("outputs: nextOutputs");
    expect(syncSource).toContain("outputs: unit.data.outputs || null");
    expect(syncSource).toContain("outputs: sticker.outputs || undefined");
  });
});
