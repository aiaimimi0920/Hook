import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("Art node editing shortcut contract", () => {
  it("routes Ctrl+E to the shared Art editing toolbar while Tab remains the parameter shortcut", () => {
    const appSource = readFileSync(resolve(repoRoot, "src/app.tsx"), "utf8");
    const appShortcutSource = readFileSync(
      resolve(repoRoot, "src/hooks/useAppShortcutController.ts"),
      "utf8",
    );
    const stickerEditingSource = readFileSync(
      resolve(repoRoot, "src/services/appStickerEditingController.ts"),
      "utf8",
    );
    const shortcutSource = readFileSync(resolve(repoRoot, "src/services/shortcuts.ts"), "utf8");
    const unitViewSource = readFileSync(resolve(repoRoot, "src/components/UnitView.tsx"), "utf8");
    const surfaceControllerSource = readFileSync(resolve(repoRoot, "src/components/unitSurfaceController.ts"), "utf8");
    const surfaceContentSource = readFileSync(resolve(repoRoot, "src/components/UnitSurfaceContent.tsx"), "utf8");
    const visualOverlaysSource = readFileSync(resolve(repoRoot, "src/components/UnitVisualOverlays.tsx"), "utf8");
    const topStripSource = readFileSync(resolve(repoRoot, "src/components/StickerTopStrip.tsx"), "utf8");
    const editActionsSource = readFileSync(resolve(repoRoot, "src/components/StickerTopStripEditActions.tsx"), "utf8");
    const surfaceViewSource = readFileSync(resolve(repoRoot, "src/components/StickerTopStripSurfaceView.tsx"), "utf8");
    const handlerStart = stickerEditingSource.indexOf("const toggleStickerToolbarVisibility = () => {");
    const handlerEnd = stickerEditingSource.indexOf("const scheduleOverlayHitTestRefresh", handlerStart);
    const handlerSource = stickerEditingSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(shortcutSource).toContain("{ id: 'toggle-sticker-toolbar', key: 'e', modifiers: ['ctrl']");
    expect(shortcutSource).toContain("{ id: 'toggle-params', key: 'Tab', modifiers: []");
    expect(handlerSource).not.toContain("uiActions.toggleParams(stickerId);");
    expect(handlerSource).toContain('selectedUnit?.type !== "sticker" && selectedUnit?.type !== "art"');
    expect(appShortcutSource).toContain("onToggleStickerToolbar: () => {");
    expect(appShortcutSource).toContain(
      "fallback: dependencies.toggleStickerToolbarVisibility",
    );
    expect(appShortcutSource).not.toContain("onToggleStickerToolbar: tauriRuntime ? undefined");
    expect(handlerSource).toContain("now - lastToolbarToggleAt < 250");
    expect(handlerSource).toContain("uiActions.showStickerToolbar(stickerId);");
    expect(handlerSource).toContain("runWithLiveCaptureSnapshots([stickerId]");
    expect(handlerSource).toContain('if (current.type === "art")');
    expect(handlerSource).toContain('uiActions.setStickerEditMode("select");');
    expect(stickerEditingSource).toContain('unit.type !== "sticker" && unit.type !== "art"');
    expect(visualOverlaysSource).toContain('props.unit.type === "sticker" || props.unit.type === "art"');
    expect(unitViewSource).toContain('supportsBitmapTools={props.unit.type === "sticker"}');
    expect(unitViewSource).toContain('isArt={props.unit.type === "art"}');
    expect(topStripSource).not.toContain("if (props.supportsBitmapTools === false) return null;");
    expect(topStripSource).toContain('supportsBitmapTools={props.supportsBitmapTools !== false}');
    expect(topStripSource).toContain('isArt={props.isArt === true}');
    expect(editActionsSource).toContain("props.supportsBitmapTools || props.isArt");
    expect(surfaceViewSource).toContain('data-art-view-selector="true"');
    expect(surfaceViewSource).toContain('aria-label="Art 视图"');
    expect(topStripSource).toContain("current === menu ? null : menu");
    expect(surfaceViewSource).toContain('props.onToggleMenu("view")');
    expect(surfaceViewSource).toContain("props.onSurfaceViewChange?.(view.id)");
    expect(surfaceViewSource).not.toContain("<select");
    expect(surfaceControllerSource).toContain("computeSurfaceViewResetFrame(currentUnit, view)");
    expect(surfaceControllerSource).toContain("clearSurfaceViewCrop(currentUnit.data.imageEditState)");
    expect(surfaceControllerSource).toContain("computeSurfaceViewWindowPresentation(unit, selectedSurfaceView()");
    expect(surfaceContentSource).toContain("displayScale={props.surfacePresentation?.scale ?? 1}");
  });
});
