import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("CanvasSelection capture overlay", () => {
  it("keeps the capture guides above selected stickers during secondary capture", () => {
    const selectionSourcePath = path.resolve(
      process.cwd(),
      "src/components/CanvasSelection.tsx",
    );
    const unitViewSourcePath = path.resolve(
      process.cwd(),
      "src/components/UnitView.tsx",
    );
    const selectionSource = fs.readFileSync(selectionSourcePath, "utf8");
    const unitViewSource = fs.readFileSync(unitViewSourcePath, "utf8");

    const selectionZValues = Array.from(
      selectionSource.matchAll(/z-\[(\d+)\]/g),
      (match) => Number(match[1]),
    );
    const selectedStickerZMatch = unitViewSource.match(
      /"z-index":\s*props\.isSelected\s*\?\s*(\d+)\s*:\s*\d+/,
    );

    expect(selectionZValues.length).toBeGreaterThan(0);
    expect(selectedStickerZMatch).not.toBeNull();
    expect(Math.max(...selectionZValues)).toBeGreaterThan(
      Number(selectedStickerZMatch![1]),
    );
  });

  it("does not render a select-area text prompt before the first drag point", () => {
    const sourcePath = path.resolve(
      process.cwd(),
      "src/components/CanvasSelection.tsx",
    );
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).not.toContain("Select Area");
  });

  it("does not dim the desktop while capture selection is active", () => {
    const sourcePath = path.resolve(
      process.cwd(),
      "src/components/CanvasSelection.tsx",
    );
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).not.toContain("bg-dimmer");
    expect(source).not.toContain("9999px rgba(0, 0, 0");
    expect(source).not.toContain("bg-primary/20");
  });

  it("keeps a non-capturing long-capture region guide visible during recording", () => {
    const sourcePath = path.resolve(
      process.cwd(),
      "src/components/CanvasSelection.tsx",
    );
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain("longCaptureSession");
    expect(source).toContain("长截图区域");
    expect(source).toContain('"outline-offset"');
    expect(source).toContain("pointer-events-none");
  });

  it("keeps the visible long-capture guide aligned with the captured rectangle", () => {
    const sourcePath = path.resolve(
      process.cwd(),
      "src/components/CanvasSelection.tsx",
    );
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain('"outline-offset": "0px"');
    expect(source).not.toContain('"outline-offset": "8px"');
    expect(source).not.toContain("0 0 0 1px rgba(15, 23, 42");
  });

  it("renders the live selection size chip with a dark terminal slab instead of white text on signal-yellow fill", () => {
    const sourcePath = path.resolve(
      process.cwd(),
      "src/components/CanvasSelection.tsx",
    );
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).toContain("hook-capture-chip");
    expect(source).toContain("hook-capture-chip__tag");
    expect(source).not.toContain('-top-7 left-0 bg-primary text-white');
  });
});
