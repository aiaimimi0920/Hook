import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Hook legacy Escape delete contract", () => {
  it("routes Escape in unit-selected context to the same destructive handler as Delete and Backspace", () => {
    const shortcutsSource = readSource("src/hooks/useShortcuts.ts");

    expect(shortcutsSource).toContain(
      "ShortcutManager.register('delete-escape', handlers.onDelete);",
    );
    expect(shortcutsSource).not.toContain("onEscapeUnitSelected");
    expect(shortcutsSource).not.toContain("handlers.onEscapeUnitSelected");
  });

  it("keeps the selected-unit delete logic shared by Delete, Backspace, frontend Escape, and backend Escape", () => {
    const appSource = readSource("src/app.tsx");

    expect(appSource).toContain("const deleteSelectedUnitOrAnnotation = () =>");
    expect(appSource).toContain("onDelete: deleteSelectedUnitOrAnnotation");
    expect(appSource).toContain("deleteSelectedUnitOrAnnotation();");

    const deleteStart = appSource.indexOf("const deleteSelectedUnitOrAnnotation = () =>");
    const deleteEnd = appSource.indexOf("useShortcuts({", deleteStart);
    const deleteBlock = appSource.slice(deleteStart, deleteEnd);

    expect(deleteStart).toBeGreaterThan(-1);
    expect(deleteEnd).toBeGreaterThan(deleteStart);
    expect(deleteBlock).toContain("removeAnnotationById");
    expect(deleteBlock).toContain("graphStore.actions.removeUnit(id)");
    expect(deleteBlock).toContain("uiActions.clearStickerHistory(id)");
    expect(deleteBlock).toContain("selectionActions.clear()");
    expect(deleteBlock).toContain("uiActions.hideStickerToolbar()");
    expect(deleteBlock).toContain("syncService.updateBackendRects()");
    expect(appSource).toContain("hasActiveStickerEditTarget:");
  });

  it("emits global Escape from the backend so the same selected-unit delete behavior works when the overlay is not focused", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const escapeStart = rustSource.indexOf("rdev::EventType::KeyPress(rdev::Key::Escape)");
    const escapeEnd = rustSource.indexOf("rdev::EventType::MouseMove", escapeStart);
    const escapeBlock = rustSource.slice(escapeStart, escapeEnd);

    expect(escapeStart).toBeGreaterThan(-1);
    expect(escapeEnd).toBeGreaterThan(escapeStart);
    expect(escapeBlock).toContain('window.emit("trigger-escape"');
    expect(escapeBlock).toContain("append_runtime_log_line(\"rdev_escape_triggered\")");
  });
});
