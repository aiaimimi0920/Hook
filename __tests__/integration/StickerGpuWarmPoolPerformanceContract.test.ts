import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("sticker GPU warm pool performance contract", () => {
  it("keeps the warm pool bounded by entry count, pixel budget, and time", () => {
    const source = readSource("src/services/stickerGpuWarmPool.ts");

    expect(source).toContain("STICKER_GPU_WARM_MAX_ENTRIES = 5");
    expect(source).toContain("STICKER_GPU_WARM_PIXEL_BUDGET_BYTES = 64 * 1024 * 1024");
    expect(source).toContain("STICKER_GPU_WARM_RECENT_TTL_MS = 10_000");
    expect(source).toContain("STICKER_GPU_WARM_HOVER_DELAY_MS = 50");
    expect(source).toContain(".filter((entry) => !entry.dragging)");
  });

  it("prewarms only the sticker root from hover and selection state", () => {
    const source = readSource("src/components/UnitView.tsx");

    expect(source).toContain('if (!element || unit.type !== "sticker") return;');
    expect(source).toContain("registerStickerGpuWarmElement(unit.id, element");
    expect(source).toContain("setStickerGpuWarmSelected(unit.id, props.isSelected)");
    expect(source).toContain("onPointerEnter={() => enterStickerGpuWarmHover(props.unit.id)}");
    expect(source).toContain("onPointerLeave={() => leaveStickerGpuWarmHover(props.unit.id)}");
    expect(source).toContain("unregisterStickerGpuWarmElement(registration.unitId, registration.element)");
  });

  it("marks every dragged unit warm before collecting compositor followers", () => {
    const source = readSource("src/hooks/useDraggable.ts");
    const beginIndex = source.indexOf("beginStickerGpuWarmDrag(unitId);");
    const prepareIndex = source.indexOf("prepareDragVisualFastPath();", beginIndex);
    const clearIndex = source.indexOf("clearDragVisualFastPath();", prepareIndex);
    const endIndex = source.indexOf("finishGpuWarmDrag();", clearIndex);

    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(prepareIndex).toBeGreaterThan(beginIndex);
    expect(clearIndex).toBeGreaterThan(prepareIndex);
    expect(endIndex).toBeGreaterThan(clearIndex);
    expect(source).toContain("dragStartedPrewarmed = isStickerGpuWarm(id)");
    expect(source).toContain("prewarmed=${dragStartedPrewarmed ? 1 : 0}");
  });
});
