import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const path = (...parts: string[]) => resolve(process.cwd(), ...parts);
const read = (...parts: string[]) => readFileSync(path(...parts), "utf8");

describe("QR/barcode capability migration contract", () => {
  it("keeps decoders and product UI out of Hook core", () => {
    expect(existsSync(path("src-tauri", "src", "barcode.rs"))).toBe(false);
    expect(existsSync(path("src", "services", "barcodeScanAction.ts"))).toBe(false);
    expect(existsSync(path("src", "components", "UnitBarcodeResultPanel.tsx"))).toBe(false);
    expect(read("src-tauri", "Cargo.toml")).not.toContain("rxing");
    expect(read("src-tauri", "src", "native", "app_runtime.rs")).not.toContain("decode_barcodes");
  });

  it("imports old session results into the official OCR attachment namespace", () => {
    const mapping = read("src", "services", "sessionStickerMapping.ts");
    const migration = read("src", "services", "legacyBarcodeAttachmentMigration.ts");
    expect(mapping).toContain("migrateLegacyBarcodeResultToAttachment");
    expect(migration).toContain('LEGACY_CODES_PLUGIN_ID = "neuro.official/ocr"');
    expect(migration).toContain('LEGACY_CODES_TYPE_ID = "neuro.official/ocr.codes.v1"');
    expect(migration).toContain("sanitizePersistedUnitExtensionState(candidate)");
  });
});
