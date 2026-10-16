import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Art scalar output contract", () => {
  it("persists scalar delivery values into unit output ports for downstream parameter links", () => {
    const deliveryHandlerSource = readFileSync(
      resolve(process.cwd(), "src/app/appArtDeliveryHandler.ts"),
      "utf8",
    );
    const unitTypeSource = readFileSync(resolve(process.cwd(), "src/features/workspace/types/unit.ts"), "utf8");
    const protocolSource = readFileSync(resolve(process.cwd(), "src/integrations/loom/protocol.ts"), "utf8");
    const syncSource = readFileSync(resolve(process.cwd(), "src/features/workspace/services/syncService.ts"), "utf8");
    // The session-load mapping (sticker.outputs -> unit output ports) was
    // extracted from syncService.ts into its own module.
    const mappingSource = readFileSync(resolve(process.cwd(), "src/features/workspace/services/sessionStickerMapping.ts"), "utf8");
    // Pure extraction stays separate from the delivery handler that owns the
    // protocol switch and final graph write.
    const deliveryOutputsSource = readFileSync(resolve(process.cwd(), "src/features/art/services/artDeliveryOutputs.ts"), "utf8");

    expect(protocolSource).toContain("'shared_memory' | 'base64' | 'file_path' | 'value'");
    expect(protocolSource).toContain("outputs?: Record<string, unknown>");
    expect(unitTypeSource).toContain("outputs?: Record<string, unknown>");
    expect(deliveryHandlerSource).toContain('case "value":');
    expect(deliveryOutputsSource).toContain("output: delivery.value ?? delivery.data");
    expect(deliveryHandlerSource).toContain("outputs: nextOutputs");
    expect(syncSource).toContain("outputs: u.data?.outputs || null");
    expect(mappingSource).toContain("outputs: sticker.outputs || undefined");
  });
});
