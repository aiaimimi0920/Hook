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

describe("overlay synthetic port linking contract", () => {
  it("resolves live hit targets during an active port-link drag so mouseup can land on the target input port instead of the original output port", () => {
    const appSource = readSource("src/app.tsx");
    // Synthetic engine extracted into its own module; app.tsx injects linkingState.
    const overlaySource = readSource("src/services/overlaySyntheticEvents.ts");
    const dispatchBlock = sourceBetween(
      overlaySource,
      "const dispatchSyntheticOverlayMouseEvent = (",
      "const relayOverlaySyntheticPointerMove = (event: MouseEvent) =>",
    );

    expect(appSource).toContain("linkingState");
    expect(dispatchBlock).toContain("const shouldResolveLiveOverlayTarget =");
    expect(dispatchBlock).toContain("deps.isLinking()");
    expect(dispatchBlock).toContain('type === "mouseup"');
    expect(dispatchBlock).toContain('type === "mousemove"');
    expect(dispatchBlock).toContain("target = resolveTarget(true);");

    const liveTargetIndex = dispatchBlock.indexOf("if (shouldResolveLiveOverlayTarget)");
    const stickyTargetIndex = dispatchBlock.indexOf("overlaySyntheticPointerTarget", liveTargetIndex);
    expect(liveTargetIndex).toBeGreaterThanOrEqual(0);
    expect(stickyTargetIndex).toBeGreaterThan(liveTargetIndex);
  });
});
