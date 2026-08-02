import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";

vi.mock("../../src/services/syncService", () => ({
  syncService: {
    updateBackendRects: vi.fn(async () => undefined),
    performWorkflowSync: vi.fn(async () => undefined),
  },
}));

vi.mock("../../src/services/api", () => ({
  api: {
    debugLogEvent: vi.fn(async () => undefined),
  },
}));

import { useDraggable } from "../../src/hooks/useDraggable";
import { graphStore } from "../../src/store/graphStore";
import {
  multiDragPositions,
  setDraggingStickerId,
  setMultiDragPositions,
  setSelectedUnitIds,
} from "../../src/store/uiStore";
import type { Unit } from "../../src/types/unit";
import {
  clearStickerGpuWarmPool,
  getStickerGpuWarmPoolSnapshot,
  registerStickerGpuWarmElement,
  setStickerGpuWarmSelected,
} from "../../src/services/stickerGpuWarmPool";

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: "sticker-fast-path",
  type: "sticker",
  x: 100,
  y: 200,
  w: 320,
  h: 180,
  data: {},
  params: {},
  inputs: [],
  outputs: [],
  ...overrides,
});

const draggableDisposers: Array<() => void> = [];
const createDraggable = () =>
  createRoot((dispose) => {
    draggableDisposers.push(dispose);
    return useDraggable();
  });

describe("useDraggable compositor fast path", () => {
  beforeEach(() => {
    graphStore.setUnits([]);
    graphStore.setLinks([]);
    setSelectedUnitIds([]);
    setDraggingStickerId(null);
    setMultiDragPositions(null);
    clearStickerGpuWarmPool();
    document.body.replaceChildren();
  });

  afterEach(() => {
    while (draggableDisposers.length > 0) {
      draggableDisposers.pop()?.();
    }
    clearStickerGpuWarmPool();
  });

  it("moves follower elements directly and avoids reactive drag-position work when there are no links", async () => {
    graphStore.setUnits([unit()]);

    const follower = document.createElement("div");
    follower.setAttribute("data-hook-drag-follow-unit-id", "sticker-fast-path");
    follower.style.transform = "scale(1)";
    follower.style.transitionProperty = "opacity";
    document.body.append(follower);

    const draggable = createDraggable();
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    expect(follower.style.willChange).toBe("transform");
    expect(follower.style.transitionProperty).toBe("none");
    draggable.handleDragMove(new MouseEvent("mousemove", { clientX: 130, clientY: 250 }));

    expect(follower.style.transform).toBe("translate3d(20px, 30px, 0)");
    expect(follower.style.willChange).toBe("transform");
    expect(follower.style.transitionProperty).toBe("none");
    expect(multiDragPositions()).toBeNull();

    await draggable.handleDragEnd();

    expect(graphStore.units[0]?.x).toBe(120);
    expect(graphStore.units[0]?.y).toBe(230);
    expect(follower.style.transform).toBe("scale(1)");
    expect(follower.style.willChange).toBe("");
    expect(follower.style.transitionProperty).toBe("opacity");
  });

  it("restores the root follower to its warm-pool style after a drag", async () => {
    graphStore.setUnits([unit()]);

    const follower = document.createElement("div");
    follower.setAttribute("data-hook-drag-follow-unit-id", "sticker-fast-path");
    follower.style.willChange = "opacity";
    document.body.append(follower);
    registerStickerGpuWarmElement("sticker-fast-path", follower, 320, 180, 1);
    setStickerGpuWarmSelected("sticker-fast-path", true);
    expect(follower.style.willChange).toBe("opacity, transform");

    const draggable = createDraggable();
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    expect(follower.style.willChange).toBe("transform");
    draggable.handleDragMove(new MouseEvent("mousemove", { clientX: 130, clientY: 250 }));
    await draggable.handleDragEnd();

    expect(follower.style.transform).toBe("");
    expect(follower.style.willChange).toBe("opacity, transform");
  });

  it("releases eviction protection when the draggable owner is disposed mid-drag", () => {
    graphStore.setUnits([unit()]);
    const follower = document.createElement("div");
    follower.setAttribute("data-hook-drag-follow-unit-id", "sticker-fast-path");
    document.body.append(follower);
    registerStickerGpuWarmElement("sticker-fast-path", follower, 320, 180, 1);

    const draggable = createDraggable();
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    expect(getStickerGpuWarmPoolSnapshot().entries[0]?.dragging).toBe(true);

    draggableDisposers.pop()?.();

    expect(getStickerGpuWarmPoolSnapshot().entries[0]?.dragging).toBe(false);
    expect(follower.style.transform).toBe("");
    expect(follower.style.willChange).toBe("transform");
  });
});
