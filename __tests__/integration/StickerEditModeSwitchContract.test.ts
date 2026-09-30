import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("sticker edit mode switching contract", () => {
  it("exits the previous sticker edit mode before dragging a different unit", () => {
    const interactionSource = readSource("src/services/appCanvasInteractions.ts");
    const startDragIndex = interactionSource.indexOf("startDrag(event, id");
    const switchGuardIndex = interactionSource.indexOf("activeEditTarget !== id");
    const hideToolbarIndex = interactionSource.indexOf("uiActions.hideStickerToolbar();", switchGuardIndex);

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

  it("blocks whole-sticker dragging while create tools or sticker-surface tools are active on the current edit target", () => {
    const unitViewSource = readSource("src/components/UnitView.tsx");
    const guardStart = unitViewSource.indexOf("const shouldBlockContainerMouseDown = () => {");
    const guardEnd = unitViewSource.indexOf("const allowContainerMouseDown = () => !shouldBlockContainerMouseDown();", guardStart);
    const guardSource = unitViewSource.slice(guardStart, guardEnd);

    expect(guardStart).toBeGreaterThanOrEqual(0);
    expect(guardEnd).toBeGreaterThan(guardStart);
    expect(guardSource).toContain('stickerToolSettings.domain === "create"');
    expect(guardSource).toContain('stickerToolSettings.activeCanvasTool !== "idle"');
  });

  it("gives the active sticker editor priority over extension overlay pointer input", () => {
    const unitViewSource = readSource("src/components/UnitView.tsx");

    expect(unitViewSource).toContain(
      "editorOwnsPointerInput={props.isSelected && activeStickerEditTargetId() === props.unit.id}",
    );
  });
});
