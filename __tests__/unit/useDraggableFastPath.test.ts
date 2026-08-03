import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComponent, createRoot } from "solid-js";
import { render } from "solid-js/web";

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

import { DRAG_WATCHDOG_TIMEOUT_MS, useDraggable } from "../../src/hooks/useDraggable";
import { graphStore } from "../../src/store/graphStore";
import {
  draggingStickerId,
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
import { UnitAddNodeMenu } from "../../src/components/UnitAddNodeMenu";
import {
  clearDragFollowerRegistry,
  registerDragFollowerElement,
  unregisterDragFollowerElement,
} from "../../src/services/dragFollowerRegistry";

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
    clearDragFollowerRegistry();
    document.body.replaceChildren();
  });

  afterEach(() => {
    while (draggableDisposers.length > 0) {
      draggableDisposers.pop()?.();
    }
    clearStickerGpuWarmPool();
    clearDragFollowerRegistry();
    vi.restoreAllMocks();
  });

  it("moves follower elements directly and avoids reactive drag-position work when there are no links", async () => {
    graphStore.setUnits([unit()]);

    const follower = document.createElement("div");
    follower.setAttribute("data-hook-drag-follow-unit-id", "sticker-fast-path");
    follower.style.transform = "scale(1)";
    follower.style.transitionProperty = "opacity";
    document.body.append(follower);
    registerDragFollowerElement("sticker-fast-path", follower);

    const draggable = createDraggable();
    const querySelectorAll = vi.spyOn(document, "querySelectorAll");
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    expect(querySelectorAll).not.toHaveBeenCalled();
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
    querySelectorAll.mockRestore();
  });

  it("ignores unregistered data-attribute followers instead of falling back to a document scan", () => {
    graphStore.setUnits([unit()]);
    const staleFollower = document.createElement("div");
    staleFollower.setAttribute("data-hook-drag-follow-unit-id", "sticker-fast-path");
    document.body.append(staleFollower);

    const draggable = createDraggable();
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    draggable.handleDragMove(new MouseEvent("mousemove", { clientX: 130, clientY: 250 }));

    expect(staleFollower.style.transform).toBe("");
  });

  it("stops moving a follower after it unregisters", () => {
    graphStore.setUnits([unit()]);
    const follower = document.createElement("div");
    document.body.append(follower);
    registerDragFollowerElement("sticker-fast-path", follower);
    unregisterDragFollowerElement("sticker-fast-path", follower);

    const draggable = createDraggable();
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    draggable.handleDragMove(new MouseEvent("mousemove", { clientX: 130, clientY: 250 }));

    expect(follower.style.transform).toBe("");
  });

  it("moves the Shift+1 Add Art Node shell while its inner opening animation remains active", async () => {
    graphStore.setUnits([unit()]);
    const host = document.createElement("div");
    document.body.append(host);
    const disposeMenu = render(
      () => createComponent(UnitAddNodeMenu, {
        get unit() {
          return graphStore.units[0];
        },
        availableArts: [],
        onAddNode: vi.fn(),
        showActions: true,
        get currentPos() {
          const current = graphStore.units[0];
          return { x: current?.x ?? 0, y: current?.y ?? 0 };
        },
      }),
      host,
    );
    const menu = document.getElementById("actions-menu-sticker-fast-path");

    expect(menu).toBeInstanceOf(HTMLDivElement);
    expect(menu?.classList.contains("animate-in")).toBe(false);
    expect(menu?.querySelector(":scope > .animate-in")).toBeInstanceOf(HTMLDivElement);

    const draggable = createDraggable();
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    draggable.handleDragMove(new MouseEvent("mousemove", { clientX: 130, clientY: 250 }));

    expect(menu?.style.transform).toBe("translate3d(20px, 30px, 0)");

    await draggable.handleDragEnd();
    await Promise.resolve();

    expect(menu?.style.transform).toBe("");
    expect(menu?.style.left).toBe("280px");
    expect(menu?.style.top).toBe("320px");

    disposeMenu();
  });

  it("restores the root follower to its warm-pool style after a drag", async () => {
    graphStore.setUnits([unit()]);

    const follower = document.createElement("div");
    follower.setAttribute("data-hook-drag-follow-unit-id", "sticker-fast-path");
    follower.style.willChange = "opacity";
    document.body.append(follower);
    registerDragFollowerElement("sticker-fast-path", follower);
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
    registerDragFollowerElement("sticker-fast-path", follower);
    registerStickerGpuWarmElement("sticker-fast-path", follower, 320, 180, 1);

    const draggable = createDraggable();
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    expect(getStickerGpuWarmPoolSnapshot().entries[0]?.dragging).toBe(true);

    draggableDisposers.pop()?.();

    expect(getStickerGpuWarmPoolSnapshot().entries[0]?.dragging).toBe(false);
    expect(follower.style.transform).toBe("");
    expect(follower.style.willChange).toBe("transform");
  });

  it("keeps one hook instance isolated when another draggable owner is disposed", async () => {
    graphStore.setUnits([unit()]);
    const follower = document.createElement("div");
    document.body.append(follower);
    registerDragFollowerElement("sticker-fast-path", follower);

    const activeDraggable = createDraggable();
    createDraggable();
    activeDraggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    activeDraggable.handleDragMove(new MouseEvent("mousemove", { clientX: 130, clientY: 250 }));
    expect(follower.style.transform).toBe("translate3d(20px, 30px, 0)");

    draggableDisposers.pop()?.();

    expect(follower.style.transform).toBe("translate3d(20px, 30px, 0)");
    expect(draggingStickerId()).toBe("sticker-fast-path");
    await activeDraggable.handleDragEnd();
    expect(graphStore.units[0]?.x).toBe(120);
    expect(graphStore.units[0]?.y).toBe(230);
  });

  it.each([
    ["window blur", () => window.dispatchEvent(new Event("blur"))],
    ["pointer cancel", () => window.dispatchEvent(new Event("pointercancel"))],
  ])("aborts and releases GPU drag state on %s", (_label, interrupt) => {
    graphStore.setUnits([unit()]);
    const follower = document.createElement("div");
    document.body.append(follower);
    registerDragFollowerElement("sticker-fast-path", follower);
    registerStickerGpuWarmElement("sticker-fast-path", follower, 320, 180, 1);

    const draggable = createDraggable();
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    draggable.handleDragMove(new MouseEvent("mousemove", { clientX: 130, clientY: 250 }));
    interrupt();

    expect(draggingStickerId()).toBeNull();
    expect(multiDragPositions()).toBeNull();
    expect(getStickerGpuWarmPoolSnapshot().entries[0]?.dragging).toBe(false);
    expect(follower.style.transform).toBe("");
    expect(follower.style.willChange).toBe("transform");
  });

  it("aborts when the document becomes hidden", () => {
    graphStore.setUnits([unit()]);
    const follower = document.createElement("div");
    document.body.append(follower);
    registerDragFollowerElement("sticker-fast-path", follower);
    registerStickerGpuWarmElement("sticker-fast-path", follower, 320, 180, 1);
    const originalVisibilityState = document.visibilityState;

    const draggable = createDraggable();
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: originalVisibilityState });

    expect(draggingStickerId()).toBeNull();
    expect(getStickerGpuWarmPoolSnapshot().entries[0]?.dragging).toBe(false);
    expect(follower.style.transform).toBe("");
  });

  it("uses a watchdog to recover from a permanently lost mouseup", () => {
    vi.useFakeTimers();
    try {
      graphStore.setUnits([unit()]);
      const follower = document.createElement("div");
      document.body.append(follower);
      registerDragFollowerElement("sticker-fast-path", follower);
      registerStickerGpuWarmElement("sticker-fast-path", follower, 320, 180, 1);

      const draggable = createDraggable();
      draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
      vi.advanceTimersByTime(DRAG_WATCHDOG_TIMEOUT_MS - 1);
      expect(getStickerGpuWarmPoolSnapshot().entries[0]?.dragging).toBe(true);

      vi.advanceTimersByTime(1);
      expect(draggingStickerId()).toBeNull();
      expect(getStickerGpuWarmPoolSnapshot().entries[0]?.dragging).toBe(false);
      expect(follower.style.transform).toBe("");

      draggableDisposers.pop()?.();
      clearStickerGpuWarmPool();
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces a burst of raw moves and commits the final pointer position", async () => {
    graphStore.setUnits([unit()]);
    const follower = document.createElement("div");
    document.body.append(follower);
    registerDragFollowerElement("sticker-fast-path", follower);
    let scheduledFrame: FrameRequestCallback | undefined;
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scheduledFrame = callback;
      return 42;
    });
    const cancelAnimationFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const draggable = createDraggable();
    draggable.startDrag(new MouseEvent("mousedown", { clientX: 110, clientY: 220 }), "sticker-fast-path");
    for (let index = 0; index < 500; index += 1) {
      draggable.handleDragMove(new MouseEvent("mousemove", {
        clientX: 111 + index,
        clientY: 220,
      }));
    }

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    scheduledFrame?.(performance.now());
    await draggable.handleDragEnd();

    expect(graphStore.units[0]?.x).toBe(600);
    expect(graphStore.units[0]?.y).toBe(200);
    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
  });
});
