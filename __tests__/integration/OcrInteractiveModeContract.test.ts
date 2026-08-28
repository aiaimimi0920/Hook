import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook OCR floating interaction contract", () => {
  it("makes Ctrl+2 and Alt+2 OCR results clickable without a second shortcut", () => {
    const routingSource = readFileSync(
      resolve(process.cwd(), "src", "services", "ocrShortcutRouting.ts"),
      "utf8",
    );
    const controllerSource = readFileSync(
      resolve(process.cwd(), "src", "hooks", "useAppShortcutController.ts"),
      "utf8",
    );
    const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");
    const overlaySource = readFileSync(
      resolve(process.cwd(), "src", "components", "UnitVisualOverlays.tsx"),
      "utf8",
    );
    const unitActionsSource = readFileSync(
      resolve(process.cwd(), "src", "hooks", "useUnitActions.ts"),
      "utf8",
    );
    const copyNoticeSource = readFileSync(
      resolve(process.cwd(), "src", "services", "ocrCopyNotice.ts"),
      "utf8",
    );
    const noticeSource = readFileSync(
      resolve(process.cwd(), "src", "components", "UnitEnhancementNotices.tsx"),
      "utf8",
    );
    const registrySource = readFileSync(
      resolve(process.cwd(), "src", "services", "ocrOverlayInteraction.ts"),
      "utf8",
    );
    const imageApiSource = readFileSync(
      resolve(process.cwd(), "src", "services", "apiImageResource.ts"),
      "utf8",
    );
    const nativeClipboardSource = readFileSync(
      resolve(process.cwd(), "src-tauri", "src", "native", "clipboard_text.rs"),
      "utf8",
    );

    expect(routingSource).toContain("OCR_SHORTCUT_DEDUP_MS");
    expect(routingSource).toContain("toggleSelectedStickerToolbar");
    expect(routingSource).toContain("fallback();");
    expect(routingSource).toContain("refreshHitTest();");
    expect(routingSource).not.toContain("clearOcrInteractiveUnit(unitId)");
    expect(controllerSource).toContain("if (unit?.data.ocrResult && !unit.data.hideOcr)");
    expect(controllerSource).toContain("uiActions.setOcrInteractiveUnit(id)");
    expect(controllerSource).toContain("dependencies.scheduleOverlayHitTestRefresh()");
    expect(unitActionsSource).toContain("uiActions.setOcrInteractiveUnit(unitId)");
    expect(unitActionsSource).toContain("syncService.updateBackendRects()");
    expect(unitActionsSource).toContain("const copied = await copyOcrTextToClipboard(fullText)");
    expect(unitActionsSource).toContain("const res = await api.performOcr(imageDataUrl)");
    expect(unitActionsSource).toContain('showOcrCopyNotice(unitId, fullText, copied, "full")');
    expect(appSource).toContain("toggleStickerToolbarVisibility: () => toggleSelectedStickerToolbar");
    expect(overlaySource).toContain("const requestOcrCopy = (unitId: string, text: string)");
    expect(overlaySource).toContain("copyOcrTextWithNotice(unitId, text)");
    expect(overlaySource).toContain("const isInteractive = () => ocrInteractiveUnitId() === props.unit.id");
    expect(overlaySource).toContain("if (!isInteractive() || event.button !== 0) return;");
    expect(overlaySource).toContain("requestOcrCopy(props.unit.id, copiedLabel);");
    expect(noticeSource).toContain("orderEnhancementNoticesForDisplay");
    expect(overlaySource).toContain("resolveOcrOverlayBlocks");
    expect(overlaySource).toContain("resolveOcrOverlayFillColor");
    expect(overlaySource).toContain("const ocrOverlayFillColor = createMemo");
    expect(overlaySource).not.toContain('border: "1px dashed rgba(255,255,255,0.72)"');
    expect(overlaySource).not.toContain('"background-color": `${backgroundColor}ff`');
    const fillLayerSource = overlaySource.slice(
      overlaySource.indexOf("Every OCR row in this sticker shares one opaque fill"),
      overlaySource.indexOf("Text is deliberately above all opaque fills"),
    );
    expect(fillLayerSource).not.toContain("border:");
    expect(fillLayerSource).not.toContain("dashed");
    expect(fillLayerSource).not.toContain("opacity");
    expect(overlaySource).toContain('"background-color": ocrOverlayFillColor().hex');
    expect(overlaySource).toContain("ocrOverlayFillColor().hex,");
    expect(overlaySource).not.toContain("ocrOverlayFillColor().alpha");
    expect(overlaySource).toContain('style={{ "z-index": 15 }}');
    expect(overlaySource).toContain('style={{ "z-index": 16 }}');
    expect(overlaySource).toContain('overflow: "visible"');
    expect(overlaySource).toContain('"display": "block"');
    expect(overlaySource).not.toContain('"align-items": "center"');
    expect(overlaySource).toContain('role={isInteractive() ? "button" : undefined}');
    expect(registrySource).toContain('OCR_OVERLAY_RECT_PREFIX = "OCR_TEXT"');
    expect(registrySource).toContain("api.copyTextToClipboard(text)");
    expect(copyNoticeSource).toContain("uiActions.showEnhancementNotice(unitId");
    expect(imageApiSource).toContain('safeInvoke("copy_text_to_clipboard", { text })');
    expect(nativeClipboardSource).toContain("arboard::Clipboard::new()");
    expect(registrySource).toContain("addOrUpdateRect(rect)");
  });

  it("keeps OCR interaction transient and clears stale unit state", () => {
    const storeSource = readFileSync(resolve(process.cwd(), "src", "store", "uiStore.ts"), "utf8");
    expect(storeSource).toContain("ocrInteractiveUnitId");
    expect(storeSource).toContain("setOcrInteractiveUnitId(null)");
    expect(storeSource).toContain("retainUnitScopedState");
  });
});
