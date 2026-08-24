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
    const nativeActionSource = readSource("src/services/appNativeActionController.ts");
    const canvasInteractionSource = readSource("src/services/appCanvasInteractions.ts");
    const facadeSource = readSource("src/services/overlaySyntheticEvents.ts");
    const stateSource = readSource("src/services/overlaySyntheticState.ts");
    const dispatchSource = readSource("src/services/overlaySyntheticDispatch.ts");
    const beginCaptureBlock = sourceBetween(
      nativeActionSource,
      "const beginCaptureSelection = async (mode: CaptureSelectionMode) => {",
      "const handleNativeEscape =",
    );
    const globalMouseUpBlock = sourceBetween(
      canvasInteractionSource,
      "const handleGlobalMouseUp = (event: MouseEvent) => {",
      "const handleGlobalMouseDown = (event: MouseEvent) => {",
    );
    const dispatchBlock = sourceBetween(
      dispatchSource,
      "const dispatchSyntheticOverlayMouseEvent = (",
      "const relayOverlaySyntheticPointerMove = (event: MouseEvent): void => {",
    );

    expect(stateSource).toContain("state.pointerTarget = null;");
    expect(stateSource).toContain("state.pointerActive = false;");
    expect(stateSource).toContain("state.primaryButtonDown = false;");
    expect(stateSource).toContain("state.moveRelayActive = false;");
    expect(beginCaptureBlock).toContain("overlaySynthetic.reset();");
    expect(globalMouseUpBlock).toContain("shouldResetOverlaySyntheticOnGlobalMouseUp(tauriRuntime, event.isTrusted)");
    expect(globalMouseUpBlock).toContain("overlaySynthetic.reset();");
    expect(facadeSource).toContain("return !tauriRuntime || isTrusted;");
    expect(dispatchBlock).toContain("if (type === \"mousedown\") {");
    expect(dispatchBlock).toContain("resetOverlaySyntheticState(state);");
  });
});
