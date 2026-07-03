import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const readSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("Hook overlay interactivity recovery", () => {
  it("restores click-through without hiding and re-showing the overlay window before refreshing hit-test rects after capture success", () => {
    const source = readSource("src/hooks/useSelection.ts");

    const hideToTrayIndex = source.indexOf("await api.hideToTray()");
    const showOverlayIndex = source.indexOf("await api.showOverlayHost(true);");
    const setClickThroughIndex = source.indexOf("await api.setOverlayClickThrough(true);");
    const updateRectsIndex = source.indexOf("await syncService.updateBackendRects();");

    expect(hideToTrayIndex).toBe(-1);
    expect(showOverlayIndex).toBe(-1);
    expect(setClickThroughIndex).toBeGreaterThan(-1);
    expect(updateRectsIndex).toBeGreaterThan(-1);
    expect(setClickThroughIndex).toBeLessThan(updateRectsIndex);
  });

  it("does not force the overlay back into click-through after backend rect refresh finishes a successful capture", () => {
    const source = readSource("src/hooks/useSelection.ts");
    const successStart = source.indexOf("const addCaptureUnit = async");
    const successEnd = source.indexOf("const sampleAutoLongCaptureFrame", successStart);
    const successBlock = source.slice(successStart, successEnd);

    const updateRectsIndex = successBlock.indexOf("await syncService.updateBackendRects();");
    const finalClickThroughIndex = successBlock.indexOf(
      "await api.setOverlayClickThrough(true);",
      updateRectsIndex,
    );

    expect(successStart).toBeGreaterThan(-1);
    expect(successEnd).toBeGreaterThan(successStart);
    expect(updateRectsIndex).toBeGreaterThan(-1);
    expect(finalClickThroughIndex).toBe(-1);
  });

  it("selects the newly captured sticker immediately after adding it to the graph store", () => {
    const source = readSource("src/hooks/useSelection.ts");
    const successStart = source.indexOf("const addCaptureUnit = async");
    const successEnd = source.indexOf("const sampleAutoLongCaptureFrame", successStart);
    const successBlock = source.slice(successStart, successEnd);

    const addUnitIndex = successBlock.indexOf("graphStore.actions.addUnit(newUnit);");
    const selectIndex = successBlock.indexOf("selectionActions.set([newUnit.id]);");

    expect(addUnitIndex).toBeGreaterThan(-1);
    expect(selectIndex).toBeGreaterThan(addUnitIndex);
  });
});
