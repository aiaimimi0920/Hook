import { describe, expect, it } from "vitest";
import { migrateLegacyBarcodeResultToAttachment } from "../../src/services/legacyBarcodeAttachmentMigration";
import { MAX_ATTACHMENTS_PER_UNIT } from "../../src/services/unitExtensionValidation";
import {
  mapSessionStickerToUnit,
  type SessionStickerMappingDeps,
} from "../../src/services/sessionStickerMapping";
import { mapUnitToSessionSticker } from "../../src/services/sessionStickerPayload";
import type { BarcodeScanResult, Unit } from "../../src/types/unit";
import type { UnitExtensionState } from "../../src/types/unitExtension";

const scan: BarcodeScanResult = {
  width: 640,
  height: 480,
  selectedId: "code-1",
  results: [{
    id: "code-1",
    format: "QR_CODE",
    text: "https://example.com/hook",
    url: "https://example.com/hook",
    points: [{ x: 10, y: 20 }],
    bounds: { left: 10, top: 20, right: 110, bottom: 120 },
  }],
};

const legacySticker: Unit = {
  id: "sticker-1",
  type: "sticker",
  x: 0,
  y: 0,
  w: 640,
  h: 480,
  data: { src: "data:image/png;base64,fixture", barcodeResult: scan },
  params: { image: "" },
  inputs: [{ id: "image", type: "image", direction: "input" }],
  outputs: [{ id: "output_image", type: "image", direction: "output" }],
};

describe("legacy QR/barcode migration", () => {
  it("moves a complete legacy result into one official OCR attachment", () => {
    const persisted = mapUnitToSessionSticker(legacySticker);
    const deps: SessionStickerMappingDeps = { capabilities: [] };
    const restored = mapSessionStickerToUnit(persisted, deps);
    const attachment = restored.data.extensionState?.attachments[0];

    expect(restored.data.barcodeResult).toBeUndefined();
    expect(attachment?.pluginId).toBe("neuro.official/ocr");
    expect(attachment?.typeId).toBe("neuro.official/ocr.codes.v1");
    expect(attachment?.rendererId).toBe("neuro.official/ocr.codes-overlay");
    expect(attachment?.payload).toMatchObject({
      schemaVersion: "1",
      selectedId: "code-1",
      results: scan.results,
      migration: { source: "hook.unitData.barcodeResult", version: 1 },
    });
    const scene = attachment?.payload as { surfaceScene?: { children?: unknown[] } };
    expect(scene.surfaceScene?.children).toHaveLength(1);
  });

  it("is idempotent after a completed attachment exists", () => {
    const first = migrateLegacyBarcodeResultToAttachment(scan, undefined);
    const second = migrateLegacyBarcodeResultToAttachment(scan, first.extensionState);
    expect(first.migrated).toBe(true);
    expect(second.migrated).toBe(true);
    expect(second.barcodeResult).toBeUndefined();
    expect(second.extensionState).toEqual(first.extensionState);
  });

  it("preserves legacy data when conversion cannot be complete", () => {
    const malformed = {
      ...scan,
      results: [{ ...scan.results[0], points: [{ x: Number.NaN, y: 20 }] }],
    };
    const invalidPayload = migrateLegacyBarcodeResultToAttachment(malformed, undefined);
    const invalidEnvelope = migrateLegacyBarcodeResultToAttachment(scan, undefined, false);
    expect(invalidPayload.migrated).toBe(false);
    expect(invalidPayload.barcodeResult).toBe(malformed);
    expect(invalidEnvelope.migrated).toBe(false);
    expect(invalidEnvelope.barcodeResult).toBe(scan);
  });

  it("does not overwrite a conflicting official OCR attachment", () => {
    const extensionState: UnitExtensionState = {
      schemaVersion: 1,
      revision: 4,
      attachments: [{
        attachmentId: "neuro.official/ocr.codes",
        typeId: "neuro.official/ocr.other.v1",
        schemaVersion: "1",
        revision: 1,
        pluginId: "neuro.official/ocr",
        pluginVersion: "1.1.0",
        payload: { schemaVersion: "1", retained: true },
        resourceRefs: [],
      }],
    };

    const result = migrateLegacyBarcodeResultToAttachment(scan, extensionState);

    expect(result).toEqual({
      barcodeResult: scan,
      extensionState,
      migrated: false,
    });
  });

  it("preserves legacy data when the attachment envelope is at capacity", () => {
    const extensionState: UnitExtensionState = {
      schemaVersion: 1,
      revision: 7,
      attachments: Array.from({ length: MAX_ATTACHMENTS_PER_UNIT }, (_, index) => ({
        attachmentId: `test.plugin.item-${index}`,
        typeId: "test.plugin.payload.v1",
        schemaVersion: "1",
        revision: 1,
        pluginId: "test.plugin",
        pluginVersion: "1.0.0",
        payload: { index },
        resourceRefs: [],
      })),
    };

    const result = migrateLegacyBarcodeResultToAttachment(scan, extensionState);

    expect(result.migrated).toBe(false);
    expect(result.barcodeResult).toBe(scan);
    expect(result.extensionState).toBe(extensionState);
  });

  it("does not overflow the extension revision", () => {
    const extensionState: UnitExtensionState = {
      schemaVersion: 1,
      revision: Number.MAX_SAFE_INTEGER,
      attachments: [],
    };

    const result = migrateLegacyBarcodeResultToAttachment(scan, extensionState);

    expect(result.migrated).toBe(false);
    expect(result.barcodeResult).toBe(scan);
    expect(result.extensionState).toBe(extensionState);
  });
});
