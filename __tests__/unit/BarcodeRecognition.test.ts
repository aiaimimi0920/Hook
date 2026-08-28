import { describe, expect, it } from "vitest";
import {
  BARCODE_OUTPUT_PORTS,
  buildBarcodeOutputValues,
  hasBarcodeResults,
} from "../../src/services/barcodeRecognition";
import {
  mapSessionStickerToUnit,
  type SessionStickerMappingDeps,
} from "../../src/services/sessionStickerMapping";
import { mapUnitToSessionSticker } from "../../src/services/sessionStickerPayload";
import { resolveUnitOutputValue } from "../../src/services/graphImageResolution";
import { resolveImageFrame } from "../../src/services/ocrOverlayLayout";
import { resolveBarcodeOverlayRect } from "../../src/services/barcodeOverlayInteraction";
import type { BarcodeScanResult, Unit } from "../../src/types/unit";

const scan: BarcodeScanResult = {
  width: 640,
  height: 480,
  results: [{
    id: "code-1",
    format: "QR_CODE",
    text: "https://example.com/hook",
    url: "https://example.com/hook",
    points: [{ x: 10, y: 20 }],
    bounds: { left: 10, top: 20, right: 110, bottom: 120 },
  }],
};

const sticker: Unit = {
  id: "sticker-1",
  type: "sticker",
  x: 0,
  y: 0,
  w: 640,
  h: 480,
  data: {
    src: "data:image/png;base64,fixture",
    barcodeResult: scan,
    outputs: buildBarcodeOutputValues(scan),
  },
  params: { image: "" },
  inputs: [{ id: "image", type: "image", direction: "input" }],
  outputs: [{ id: "output_image", type: "image", direction: "output" }],
};

describe("barcode recognition contracts", () => {
  it("publishes stable scalar output ports and preserves every result", () => {
    expect(BARCODE_OUTPUT_PORTS.map((port) => port.name)).toEqual([
      "recognized_url",
      "recognized_text",
      "recognized_codes",
    ]);
    expect(buildBarcodeOutputValues(scan)).toEqual({
      recognized_url: scan.results[0].url,
      recognized_text: scan.results[0].text,
      recognized_codes: scan.results,
    });
    expect(hasBarcodeResults(scan)).toBe(true);
    expect(hasBarcodeResults({ ...scan, results: [] })).toBe(false);
  });

  it("uses the explicitly selected result for scalar outputs", () => {
    const second = { ...scan.results[0], id: "code-2", text: "https://example.com/second", url: "https://example.com/second" };
    const selected = { ...scan, results: [scan.results[0], second], selectedId: second.id };
    expect(buildBarcodeOutputValues(selected).recognized_url).toBe(second.url);
    expect(buildBarcodeOutputValues(selected).recognized_text).toBe(second.text);
  });

  it("round-trips barcode results through the session sticker boundary", () => {
    const persisted = mapUnitToSessionSticker(sticker);
    expect(persisted.barcodeResult).toEqual(scan);

    const deps: SessionStickerMappingDeps = { capabilities: [] };
    const restored = mapSessionStickerToUnit(persisted, deps);
    expect(restored.data.barcodeResult).toEqual(scan);
  });

  it("resolves recognized URL output through a downstream value link", () => {
    const target: Unit = {
      ...sticker,
      id: "art-1",
      type: "art",
      artId: "text-art",
      data: {},
      params: { prompt: "" },
      inputs: [{ id: "prompt", type: "text", direction: "input" }],
      outputs: [],
    };
    expect(resolveUnitOutputValue({
      units: [sticker, target],
      links: [{ id: "link-1", fromUnitId: sticker.id, fromPortId: "recognized_url", toUnitId: target.id, toPortId: "prompt" }],
      unitId: sticker.id,
      portId: "recognized_url",
      capabilities: [],
    })).toBe(scan.results[0].url);
  });

  it("maps barcode coordinates to the same letterboxed frame and native hit rect", () => {
    const frame = resolveImageFrame(sticker, false, 330, 330);
    expect(frame?.left).toBeCloseTo(80);
    expect(frame?.top).toBe(0);
    const rect = frame && resolveBarcodeOverlayRect(sticker, frame, scan.results[0]);
    expect(rect?.x).toBeCloseTo(94.545);
    expect(rect?.width).toBe(24);
    expect(rect?.height).toBe(24);
  });
});
