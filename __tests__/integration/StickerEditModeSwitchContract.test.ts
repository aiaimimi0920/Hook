import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("sticker edit mode switching contract", () => {
  it("exits the previous sticker edit mode before dragging a different unit", () => {
    const appSource = readSource("src/app.tsx");
    const startDragIndex = appSource.indexOf("startDrag(e, id");
    const switchGuardIndex = appSource.indexOf("activeEditTarget !== id");
    const hideToolbarIndex = appSource.indexOf("uiActions.hideStickerToolbar();", switchGuardIndex);

    expect(switchGuardIndex).toBeGreaterThan(0);
    expect(hideToolbarIndex).toBeGreaterThan(switchGuardIndex);
    expect(hideToolbarIndex).toBeLessThan(startDragIndex);
  });

  it("keeps direct drawing gestures blocked only for the active non-select sticker", () => {
    const unitViewSource = readSource("src/components/UnitView.tsx");

    expect(unitViewSource).toContain("activeStickerEditTargetId() === props.unit.id");
    expect(unitViewSource).toContain('stickerToolSettings.domain !== "existing"');
    expect(unitViewSource).toContain('stickerToolSettings.transformMode !== "select"');
    expect(unitViewSource).toContain("const shouldBlockContainerMouseDown = () =>");
    expect(unitViewSource).toContain("allowContainerMouseDown()");
  });
});
