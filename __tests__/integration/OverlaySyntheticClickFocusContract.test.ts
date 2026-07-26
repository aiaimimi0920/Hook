import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("overlay synthetic click and focus contract", () => {
  // The synthetic overlay mouse-event engine was extracted from app.tsx into
  // src/services/overlaySyntheticEvents.ts; app.tsx keeps only the wiring.
  const overlaySource = readSource("src/services/overlaySyntheticEvents.ts");

  it("dispatches a synthetic dblclick for overlay-routed sticker clicks so double-click minify still works while the full-screen overlay stays click-through", () => {
    expect(overlaySource).toContain('"dblclick"');
    expect(overlaySource).toContain("overlaySyntheticLastClickTarget");
    expect(overlaySource).toContain("overlaySyntheticLastClickAt");
    expect(overlaySource).toContain("OVERLAY_SYNTHETIC_DOUBLE_CLICK_MAX_DELAY_MS");
  });

  it("focuses overlay-hosted editors through the top-strip property bar and still keeps synthetic editable-control fallback logic for routed clicks", () => {
    const apiSource = readSource("src/services/api.ts");
    const propertyBarSource = readSource("src/components/StickerTopStripPropertyBar.tsx");

    expect(apiSource).toContain("focusOverlayWindow");
    expect(propertyBarSource).toContain("api.focusOverlayWindow()");
    expect(overlaySource).toContain("HTMLInputElement");
    expect(overlaySource).toContain("HTMLSelectElement");
    expect(overlaySource).toContain("HTMLTextAreaElement");
    expect(overlaySource).toContain(".focus()");
  });

  it("routes overlay drag move events straight to app-main and skips the synthetic relay fallback while a whole-sticker drag is active, so Ctrl+E mode does not add sticky per-move annotation-layer overhead", () => {
    const appSource = readSource("src/app.tsx");

    expect(appSource).toContain("draggingStickerId()");
    expect(overlaySource).toContain('type === "mousemove" && overlaySyntheticPrimaryButtonDown && deps.getDraggingStickerId()');
    expect(overlaySource).toContain("target = appMain ?? win;");
    expect(appSource).toContain("if (!overlaySynthetic.moveRelayActive && !draggingStickerId()) {");
  });
});
