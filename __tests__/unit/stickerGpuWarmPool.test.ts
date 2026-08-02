// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STICKER_GPU_WARM_HOVER_DELAY_MS,
  STICKER_GPU_WARM_HOVER_GRACE_MS,
  STICKER_GPU_WARM_PIXEL_BUDGET_BYTES,
  STICKER_GPU_WARM_RECENT_TTL_MS,
  beginStickerGpuWarmDrag,
  clearStickerGpuWarmPool,
  endStickerGpuWarmDrag,
  enterStickerGpuWarmHover,
  getStickerGpuWarmPoolSnapshot,
  leaveStickerGpuWarmHover,
  registerStickerGpuWarmElement,
  setStickerGpuWarmSelected,
  unregisterStickerGpuWarmElement,
  updateStickerGpuWarmEstimate,
} from "../../src/services/stickerGpuWarmPool";

const registerElement = (
  unitId: string,
  width = 100,
  height = 100,
  devicePixelRatio = 1,
) => {
  const element = document.createElement("div");
  document.body.append(element);
  registerStickerGpuWarmElement(unitId, element, width, height, devicePixelRatio);
  return element;
};

describe("sticker GPU warm pool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T00:00:00.000Z"));
    clearStickerGpuWarmPool();
    document.body.replaceChildren();
  });

  afterEach(() => {
    clearStickerGpuWarmPool();
    vi.useRealTimers();
  });

  it("warms after a short hover delay and releases after the hover grace period", () => {
    const element = registerElement("hovered");

    enterStickerGpuWarmHover("hovered");
    vi.advanceTimersByTime(STICKER_GPU_WARM_HOVER_DELAY_MS - 1);
    expect(element.style.willChange).toBe("");

    vi.advanceTimersByTime(1);
    expect(element.style.willChange).toBe("transform");

    leaveStickerGpuWarmHover("hovered");
    vi.advanceTimersByTime(STICKER_GPU_WARM_HOVER_GRACE_MS - 1);
    expect(element.style.willChange).toBe("transform");

    vi.advanceTimersByTime(1);
    expect(element.style.willChange).toBe("");
  });

  it("preserves and restores an existing inline will-change value", () => {
    const element = document.createElement("div");
    element.style.willChange = "opacity";
    document.body.append(element);
    registerStickerGpuWarmElement("styled", element, 100, 100, 1);

    setStickerGpuWarmSelected("styled", true);
    expect(element.style.willChange).toBe("opacity, transform");

    setStickerGpuWarmSelected("styled", false);
    expect(element.style.willChange).toBe("opacity");
  });

  it("keeps a recently dragged sticker warm for ten seconds", () => {
    const element = registerElement("recent");

    beginStickerGpuWarmDrag("recent");
    endStickerGpuWarmDrag("recent");
    vi.advanceTimersByTime(STICKER_GPU_WARM_RECENT_TTL_MS - 1);
    expect(element.style.willChange).toBe("transform");

    vi.advanceTimersByTime(1);
    expect(element.style.willChange).toBe("");
  });

  it("retains the five most recently dragged stickers", () => {
    const elements = Array.from({ length: 6 }, (_, index) =>
      registerElement(`recent-${index + 1}`),
    );

    for (let index = 0; index < elements.length; index += 1) {
      const unitId = `recent-${index + 1}`;
      beginStickerGpuWarmDrag(unitId);
      endStickerGpuWarmDrag(unitId);
    }

    const snapshot = getStickerGpuWarmPoolSnapshot();
    expect(snapshot.warmUnitIds).toEqual([
      "recent-2",
      "recent-3",
      "recent-4",
      "recent-5",
      "recent-6",
    ]);
    expect(elements[0].style.willChange).toBe("");
    expect(elements[5].style.willChange).toBe("transform");
  });

  it("refreshes LRU order when an older sticker is dragged again", () => {
    for (let index = 1; index <= 5; index += 1) {
      const unitId = `recent-${index}`;
      registerElement(unitId);
      beginStickerGpuWarmDrag(unitId);
      endStickerGpuWarmDrag(unitId);
    }

    beginStickerGpuWarmDrag("recent-1");
    endStickerGpuWarmDrag("recent-1");
    registerElement("recent-6");
    beginStickerGpuWarmDrag("recent-6");
    endStickerGpuWarmDrag("recent-6");

    const warmUnitIds = getStickerGpuWarmPoolSnapshot().warmUnitIds;
    expect(warmUnitIds).not.toContain("recent-2");
    expect(warmUnitIds).toContain("recent-1");
    expect(warmUnitIds).toContain("recent-6");
  });

  it("prioritizes the selected sticker over older recent entries", () => {
    for (let index = 1; index <= 5; index += 1) {
      const unitId = `recent-${index}`;
      registerElement(unitId);
      beginStickerGpuWarmDrag(unitId);
      endStickerGpuWarmDrag(unitId);
    }
    const selected = registerElement("selected");

    setStickerGpuWarmSelected("selected", true);

    const snapshot = getStickerGpuWarmPoolSnapshot();
    expect(snapshot.warmUnitIds).not.toContain("recent-1");
    expect(snapshot.warmUnitIds).toContain("selected");
    expect(selected.style.willChange).toBe("transform");
  });

  it("evicts least-recent entries when the pixel budget is exceeded", () => {
    const width = 4096;
    const height = 2048;
    for (let index = 1; index <= 3; index += 1) {
      const unitId = `large-${index}`;
      registerElement(unitId, width, height, 1);
      beginStickerGpuWarmDrag(unitId);
      endStickerGpuWarmDrag(unitId);
    }

    const snapshot = getStickerGpuWarmPoolSnapshot();
    expect(snapshot.warmUnitIds).toEqual(["large-2", "large-3"]);
    expect(snapshot.totalEstimatedBytes).toBe(STICKER_GPU_WARM_PIXEL_BUDGET_BYTES);
  });

  it("accounts for device pixel ratio and enforces the budget after a resize", () => {
    registerElement("stable", 2048, 2048, 1);
    registerElement("resized", 2048, 2048, 1);
    beginStickerGpuWarmDrag("stable");
    endStickerGpuWarmDrag("stable");
    beginStickerGpuWarmDrag("resized");
    endStickerGpuWarmDrag("resized");

    updateStickerGpuWarmEstimate("resized", 2048, 2048, 2);

    const snapshot = getStickerGpuWarmPoolSnapshot();
    expect(snapshot.warmUnitIds).toEqual(["resized"]);
    expect(snapshot.totalEstimatedBytes).toBe(STICKER_GPU_WARM_PIXEL_BUDGET_BYTES);
  });

  it("restarts the recent TTL after another drag", () => {
    const element = registerElement("reused");
    beginStickerGpuWarmDrag("reused");
    endStickerGpuWarmDrag("reused");
    vi.advanceTimersByTime(STICKER_GPU_WARM_RECENT_TTL_MS - 1_000);

    beginStickerGpuWarmDrag("reused");
    endStickerGpuWarmDrag("reused");
    vi.advanceTimersByTime(STICKER_GPU_WARM_RECENT_TTL_MS - 1);
    expect(element.style.willChange).toBe("transform");

    vi.advanceTimersByTime(1);
    expect(element.style.willChange).toBe("");
  });

  it("does not evict actively dragged stickers until the drag finishes", () => {
    for (let index = 1; index <= 6; index += 1) {
      const unitId = `dragging-${index}`;
      registerElement(unitId);
      beginStickerGpuWarmDrag(unitId);
    }

    expect(getStickerGpuWarmPoolSnapshot().warmUnitIds).toHaveLength(6);

    endStickerGpuWarmDrag("dragging-1");
    expect(getStickerGpuWarmPoolSnapshot().warmUnitIds).toHaveLength(5);
    expect(getStickerGpuWarmPoolSnapshot().warmUnitIds).not.toContain("dragging-1");
  });

  it("allows active drags to temporarily exceed the pixel budget", () => {
    for (let index = 1; index <= 3; index += 1) {
      const unitId = `large-drag-${index}`;
      registerElement(unitId, 4096, 2048, 1);
      beginStickerGpuWarmDrag(unitId);
    }

    expect(getStickerGpuWarmPoolSnapshot().totalEstimatedBytes).toBe(
      STICKER_GPU_WARM_PIXEL_BUDGET_BYTES + STICKER_GPU_WARM_PIXEL_BUDGET_BYTES / 2,
    );

    endStickerGpuWarmDrag("large-drag-1");
    expect(getStickerGpuWarmPoolSnapshot().totalEstimatedBytes).toBe(
      STICKER_GPU_WARM_PIXEL_BUDGET_BYTES,
    );
  });

  it("restores styles and removes bookkeeping when a sticker unmounts", () => {
    const element = registerElement("removed");
    setStickerGpuWarmSelected("removed", true);
    expect(element.style.willChange).toBe("transform");

    unregisterStickerGpuWarmElement("removed", element);

    expect(element.style.willChange).toBe("");
    expect(getStickerGpuWarmPoolSnapshot().entries).toEqual([]);
  });
});
