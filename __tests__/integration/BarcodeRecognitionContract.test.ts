import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(resolve(process.cwd(), ...parts), "utf8");

describe("barcode recognition integration contract", () => {
  it("keeps local decode, persisted outputs, and explicit URL actions separate", () => {
    const actionSource = read("src", "hooks", "useUnitActions.ts");
    const nativeSource = read("src-tauri", "src", "native", "app_runtime.rs");
    const decoderSource = read("src-tauri", "src", "barcode.rs");
    const urlSource = read("src-tauri", "src", "url_actions.rs");
    const payloadSource = read("src", "services", "sessionStickerPayload.ts");
    const mappingSource = read("src", "services", "sessionStickerMapping.ts");
    const outputSource = read("src", "services", "barcodeRecognition.ts");
    const overlaySource = read("src", "components", "BarcodeVisualOverlay.tsx");

    expect(actionSource).toContain("void performBarcodeAction(unitId);");
    expect(actionSource).toContain("startOperation(barcodeOperationTokens, unitId)");
    expect(actionSource).toContain("isCurrentOperation(barcodeOperationTokens, unitId, operationToken, source)");
    expect(actionSource).toContain("registerBarcodePropagation(propagateFromUnit)");
    expect(outputSource).toContain("recognized_url");
    expect(nativeSource).toContain("barcode::decode_barcodes");
    expect(nativeSource).toContain("url_actions::open_http_url");
    expect(decoderSource).toContain("detect_multiple_in_luma_with_hints");
    expect(decoderSource).toContain("MAX_RESULTS");
    expect(urlSource).toContain("Only absolute HTTP(S) URLs can be opened");
    expect(payloadSource).toContain("barcodeResult: unit.data.barcodeResult || null");
    expect(mappingSource).toContain("barcodeResult: sticker.barcodeResult || undefined");
    expect(overlaySource).toContain("selectBarcodeResult");
    expect(overlaySource).toContain("openBarcodeResultUrl");
    expect(read("src", "services", "barcodeResultActions.ts")).toContain("queueMicrotask(() => barcodePropagation?.(unitId))");
  });
});
