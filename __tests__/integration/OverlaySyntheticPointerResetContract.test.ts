import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const sourceBetween = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe("overlay synthetic pointer reset contract", () => {
  it("resets synthetic overlay state at safe ownership boundaries without erasing a pending Tauri synthetic click", () => {
    const appSource = readSource("src/app.tsx");
    // The synthetic engine (reset + dispatch logic) now lives in its own module;
    // app.tsx keeps the capture-begin and global-mouse-up call sites that reset it.
    const overlaySource = readSource("src/services/overlaySyntheticEvents.ts");
    const resetBlock = sourceBetween(
      overlaySource,
      "const resetOverlaySyntheticPointerState = () => {",
      "const dispatchSyntheticOverlayMouseEvent = (",
    );
    const beginCaptureBlock = sourceBetween(
      appSource,
      "const beginCaptureSelection = async (mode: CaptureSelectionMode) => {",
      "// Initialization",
    );
    const globalMouseUpBlock = sourceBetween(
      appSource,
      "const handleGlobalMouseUp = (e: MouseEvent) => {",
      "const handleGlobalMouseDown = (e: MouseEvent) => {",
    );
    const dispatchBlock = sourceBetween(
      overlaySource,
      "const dispatchSyntheticOverlayMouseEvent = (",
      "const relayOverlaySyntheticPointerMove = (event: MouseEvent) => {",
    );

    expect(resetBlock).toContain("overlaySyntheticPointerTarget = null;");
    expect(resetBlock).toContain("overlaySyntheticPointerActive = false;");
    expect(resetBlock).toContain("overlaySyntheticPrimaryButtonDown = false;");
    expect(resetBlock).toContain("overlaySyntheticMoveRelayActive = false;");
    expect(beginCaptureBlock).toContain("overlaySynthetic.reset();");
    expect(globalMouseUpBlock).toContain("shouldResetOverlaySyntheticOnGlobalMouseUp(tauriRuntime, e.isTrusted)");
    expect(globalMouseUpBlock).toContain("overlaySynthetic.reset();");
    expect(overlaySource).toContain("return !tauriRuntime || isTrusted;");
    expect(dispatchBlock).toContain("if (type === \"mousedown\") {");
    expect(dispatchBlock).toContain("resetOverlaySyntheticPointerState();");
  });
});
