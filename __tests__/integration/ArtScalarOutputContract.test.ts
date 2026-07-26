import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Art scalar output contract", () => {
  it("persists scalar delivery values into unit output ports for downstream parameter links", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");
    const unitTypeSource = readFileSync(resolve(process.cwd(), "src", "types", "unit.ts"), "utf8");
    const protocolSource = readFileSync(resolve(process.cwd(), "src", "services", "protocol.ts"), "utf8");
    const syncSource = readFileSync(resolve(process.cwd(), "src", "services", "syncService.ts"), "utf8");
    // The session-load mapping (sticker.outputs -> unit output ports) was
    // extracted from syncService.ts into its own module.
    const mappingSource = readFileSync(resolve(process.cwd(), "src", "services", "sessionStickerMapping.ts"), "utf8");
    // The scalar value-output extraction was moved out of app.tsx into a pure
    // helper module; app.tsx keeps the switch case and the updateUnitData wiring.
    const deliveryOutputsSource = readFileSync(resolve(process.cwd(), "src", "services", "artDeliveryOutputs.ts"), "utf8");

    expect(protocolSource).toContain("'value' | 'json' | 'text' | 'number'");
    expect(protocolSource).toContain("outputs?: Record<string, unknown>");
    expect(unitTypeSource).toContain("outputs?: Record<string, unknown>");
    expect(appSource).toContain('case "value":');
    expect(deliveryOutputsSource).toContain("output: delivery.value ?? delivery.data");
    expect(appSource).toContain("outputs: nextOutputs");
    expect(syncSource).toContain("outputs: u.data?.outputs || null");
    expect(mappingSource).toContain("outputs: sticker.outputs || undefined");
  });
});
