import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Hook Escape delete contract", () => {
  it("closes an open actions menu before the selected-unit delete handler", () => {
    const shortcutsSource = readSource("src/hooks/useShortcuts.ts");
    const appSource = readSource("src/app.tsx");
    const appShortcutSource = readSource("src/hooks/useAppShortcutController.ts");
    const nativeActionSource = readSource("src/services/appNativeActionController.ts");
    const stickerEditingSource = readSource("src/services/appStickerEditingController.ts");

    expect(shortcutsSource).toContain("isActionsMenuDismissShortcut(e)");
    expect(shortcutsSource).toContain("handlers.onCloseActions()");
    expect(stickerEditingSource).toContain("const closeSelectedActionsMenu = () =>");
    expect(appShortcutSource).toContain("onCloseActions: dependencies.closeSelectedActionsMenu");

    const nativeEscapeStart = nativeActionSource.indexOf("const handleNativeEscape = () =>");
    const nativeEscapeEnd = nativeActionSource.indexOf("const handleNativeDelete = () =>", nativeEscapeStart);
    const nativeEscapeBlock = nativeActionSource.slice(nativeEscapeStart, nativeEscapeEnd);
    expect(nativeEscapeBlock.indexOf("dependencies.closeSelectedActionsMenu()")).toBeLessThan(
      nativeEscapeBlock.indexOf("dependencies.deleteSelectedUnitOrAnnotation()"),
    );
  });

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
    const appShortcutSource = readSource("src/hooks/useAppShortcutController.ts");
    const nativeActionSource = readSource("src/services/appNativeActionController.ts");
    const stickerEditingSource = readSource("src/services/appStickerEditingController.ts");

    expect(stickerEditingSource).toContain("const deleteSelectedUnitOrAnnotation = () =>");
    expect(appShortcutSource).toContain("onDelete: dependencies.deleteSelectedUnitOrAnnotation");
    expect(nativeActionSource).toContain("dependencies.deleteSelectedUnitOrAnnotation();");

    const deleteStart = stickerEditingSource.indexOf("const deleteSelectedUnitOrAnnotation = () =>");
    const deleteEnd = stickerEditingSource.indexOf("const openImageForEdit =", deleteStart);
    const deleteBlock = stickerEditingSource.slice(deleteStart, deleteEnd);

    expect(deleteStart).toBeGreaterThan(-1);
    expect(deleteEnd).toBeGreaterThan(deleteStart);
    expect(deleteBlock).toContain("removeAnnotationsByIds");
    expect(deleteBlock).toContain("graphStore.actions.removeUnit(id)");
    expect(deleteBlock).toContain("uiActions.clearStickerHistory(id)");
    expect(deleteBlock).toContain("selectionActions.clear()");
    expect(deleteBlock).toContain("uiActions.hideStickerToolbar()");
    expect(deleteBlock).toContain("syncService.updateBackendRects()");
    expect(appShortcutSource).toContain("hasActiveStickerEditTarget:");
  });

  it("gives focused editors and blocking dialogs priority over node deletion", () => {
    const shortcutsSource = readSource("src/hooks/useShortcuts.ts");
    const appSource = readSource("src/app.tsx");
    const appShortcutSource = readSource("src/hooks/useAppShortcutController.ts");
    const nativeActionSource = readSource("src/services/appNativeActionController.ts");

    expect(shortcutsSource).toContain("handleDeferredEditableEscape");
    expect(shortcutsSource).toContain("e.defaultPrevented");
    expect(shortcutsSource).toContain('options.contextProvider() === "modal"');
    expect(shortcutsSource.indexOf('options.contextProvider() === "modal"')).toBeLessThan(
      shortcutsSource.indexOf("handlers.onCloseActions()"),
    );
    expect(appShortcutSource).toContain("hasBlockingDialog:");
    expect(appShortcutSource).toContain("hasSelectedAnnotation:");
    expect(nativeActionSource).toContain("hasActiveEditableShortcutTarget()");
    expect(nativeActionSource).toContain("hasFocusedDomShortcutOwner()");

    const nativeEscapeStart = nativeActionSource.indexOf("const handleNativeEscape = () =>");
    const nativeEscapeEnd = nativeActionSource.indexOf("const handleNativeDelete = () =>", nativeEscapeStart);
    const nativeEscapeBlock = nativeActionSource.slice(nativeEscapeStart, nativeEscapeEnd);
    expect(nativeEscapeBlock.indexOf("dependencies.surfaceConfirmationCount() > 0")).toBeLessThan(
      nativeEscapeBlock.indexOf("dependencies.deleteSelectedUnitOrAnnotation()"),
    );
    expect(nativeEscapeBlock).toContain("dependencies.rejectCurrentSurfaceConfirmation()");
    expect(nativeEscapeBlock).toContain("hasActiveEditableShortcutTarget()");
    expect(nativeEscapeBlock).toContain("hasFocusedDomShortcutOwner()");
    expect(nativeEscapeBlock.indexOf("hasFocusedDomShortcutOwner()")).toBeLessThan(
      nativeEscapeBlock.indexOf("dependencies.closeSelectedActionsMenu()"),
    );

    const nativeDeleteStart = nativeEscapeEnd;
    const nativeDeleteEnd = nativeActionSource.indexOf("return { beginCaptureSelection", nativeDeleteStart);
    const nativeDeleteBlock = nativeActionSource.slice(nativeDeleteStart, nativeDeleteEnd);
    expect(nativeDeleteBlock).toContain("dependencies.surfaceConfirmationCount() > 0");
    expect(nativeDeleteBlock).toContain("hasActiveEditableShortcutTarget()");
    expect(nativeDeleteBlock).toContain("hasFocusedDomShortcutOwner()");
    expect(nativeDeleteBlock.indexOf("hasFocusedDomShortcutOwner()")).toBeLessThan(
      nativeDeleteBlock.indexOf("dependencies.deleteSelectedUnitOrAnnotation()"),
    );
  });

  it("emits global Escape from the backend so the same selected-unit delete behavior works when the overlay is not focused", () => {
    const rustSource = readHookLibRustSources();
    const escapeStart = rustSource.indexOf("rdev::EventType::KeyPress(rdev::Key::Escape)");
    const escapeEnd = rustSource.indexOf("rdev::EventType::MouseMove", escapeStart);
    const escapeBlock = rustSource.slice(escapeStart, escapeEnd);

    expect(escapeStart).toBeGreaterThan(-1);
    expect(escapeEnd).toBeGreaterThan(escapeStart);
    expect(escapeBlock).toContain('window.emit("trigger-escape"');
    expect(escapeBlock).toContain("append_runtime_log_line(\"rdev_escape_triggered\")");
  });

  it("routes Delete and Backspace to the active sticker without an artificial timeout", () => {
    const rustSource = readHookLibRustSources();
    const deleteStart = rustSource.indexOf("rdev::EventType::KeyPress(rdev::Key::Delete)");
    const deleteEnd = rustSource.indexOf("rdev::EventType::KeyPress(rdev::Key::Return)", deleteStart);
    const deleteBlock = rustSource.slice(deleteStart, deleteEnd);

    expect(deleteStart).toBeGreaterThan(-1);
    expect(deleteEnd).toBeGreaterThan(deleteStart);
    expect(deleteBlock).toContain("rdev::EventType::KeyPress(rdev::Key::Backspace)");
    expect(deleteBlock).toContain('window.emit("trigger-delete"');
    expect(deleteBlock).toContain("append_runtime_log_line(\"rdev_delete_triggered\")");

    const appSource = readSource("src/app.tsx");
    const commandSource = readSource("src/services/appCommandListeners.ts");
    const nativeActionSource = readSource("src/services/appNativeActionController.ts");
    const deleteHandlerStart = nativeActionSource.indexOf("const handleNativeDelete = () =>");
    const deleteHandlerEnd = nativeActionSource.indexOf("return { beginCaptureSelection", deleteHandlerStart);
    const deleteHandlerBlock = nativeActionSource.slice(deleteHandlerStart, deleteHandlerEnd);

    expect(commandSource).toContain('listen("trigger-delete"');
    expect(appSource).not.toContain("STICKER_GLOBAL_DELETE_ARM_WINDOW_MS");
    expect(appSource).not.toContain("lastStickerKeyboardDeleteArmAt");
    expect(deleteHandlerBlock).toContain("if (!selectedStickerId())");
    expect(deleteHandlerBlock).toContain("dependencies.deleteSelectedUnitOrAnnotation();");
  });

  it("keeps rdev and the low-level hook on independent Escape edge trackers", () => {
    const rustSource = readHookLibRustSources();

    expect(rustSource).toContain("static ESCAPE_KEY_DOWN: AtomicBool");
    expect(rustSource).toContain("static RDEV_ESCAPE_KEY_DOWN: AtomicBool");
    expect(rustSource).toContain("static EMERGENCY_ESCAPE_TRACKER:");
    expect(rustSource).toContain("static RDEV_EMERGENCY_ESCAPE_TRACKER:");
    expect(rustSource).toContain("fn handle_rdev_emergency_escape_transition(pressed: bool)");
  });
});
