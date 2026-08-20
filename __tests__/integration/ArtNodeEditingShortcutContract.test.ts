import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("Art node editing shortcut contract", () => {
  it("routes Ctrl+E to the shared Art editing toolbar while Tab remains the parameter shortcut", () => {
    const appSource = readFileSync(resolve(repoRoot, "src/app.tsx"), "utf8");
    const shortcutSource = readFileSync(resolve(repoRoot, "src/services/shortcuts.ts"), "utf8");
    const unitViewSource = readFileSync(resolve(repoRoot, "src/components/UnitView.tsx"), "utf8");
    const topStripSource = readFileSync(resolve(repoRoot, "src/components/StickerTopStrip.tsx"), "utf8");
    const handlerStart = appSource.indexOf("const toggleStickerToolbarVisibility = () => {");
    const handlerEnd = appSource.indexOf("const scheduleOverlayHitTestRefresh", handlerStart);
    const handlerSource = appSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(shortcutSource).toContain("{ id: 'toggle-sticker-toolbar', key: 'e', modifiers: ['ctrl']");
    expect(shortcutSource).toContain("{ id: 'toggle-params', key: 'Tab', modifiers: []");
    expect(handlerSource).not.toContain("uiActions.toggleParams(stickerId);");
    expect(handlerSource).toContain('selectedUnit?.type !== "sticker" && selectedUnit?.type !== "art"');
    expect(appSource).toContain("onToggleStickerToolbar: () => {");
    expect(appSource).not.toContain("onToggleStickerToolbar: tauriRuntime ? undefined");
    expect(handlerSource).toContain("now - lastStickerToolbarToggleAt < 250");
    expect(handlerSource).toContain("uiActions.showStickerToolbar(stickerId);");
    expect(handlerSource).toContain('if (selectedUnit.type === "art")');
    expect(handlerSource).toContain('uiActions.setStickerEditMode("select");');
    expect(appSource).toContain('unit.type !== "sticker" && unit.type !== "art"');
    expect(unitViewSource).toContain('props.unit.type === "sticker" || props.unit.type === "art"');
    expect(unitViewSource).toContain('supportsBitmapTools={props.unit.type === "sticker"}');
    expect(unitViewSource).toContain('isArt={props.unit.type === "art"}');
    expect(topStripSource).not.toContain("if (props.supportsBitmapTools === false) return null;");
    expect(topStripSource).toContain('props.supportsBitmapTools !== false || props.isArt === true');
    expect(topStripSource).toContain('data-art-view-selector="true"');
    expect(topStripSource).toContain('aria-label="Art 视图"');
    expect(topStripSource).toContain('current === "view" ? null : "view"');
    expect(topStripSource).toContain("props.onSurfaceViewChange?.(view.id);");
    expect(topStripSource).not.toContain("<select");
    expect(unitViewSource).toContain("computeSurfaceViewResetFrame(currentUnit, view)");
    expect(unitViewSource).toContain("clearSurfaceViewCrop(currentUnit.data.imageEditState)");
    expect(unitViewSource).toContain("computeSurfaceViewWindowPresentation(unit, selectedSurfaceView()");
    expect(unitViewSource).toContain("displayScale={surfacePresentation().scale}");
  });
});
