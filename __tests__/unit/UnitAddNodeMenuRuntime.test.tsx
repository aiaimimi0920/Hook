// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

vi.mock("../../src/services/api", () => ({
  api: {
    focusOverlayWindow: vi.fn().mockResolvedValue(undefined),
    debugLogEvent: vi.fn().mockResolvedValue(undefined),
    updatePinRects: vi.fn().mockResolvedValue(undefined),
  },
}));

import { UnitAddNodeMenu } from "../../src/components/UnitAddNodeMenu";
import { api } from "../../src/services/api";
import {
  createOverlaySyntheticDispatcher,
  OVERLAY_GLOBAL_MOUSE_UP_EVENT,
} from "../../src/services/overlaySyntheticEvents";
import type { ArtCapability } from "../../src/services/protocol";

const arts: ArtCapability[] = [
  {
    id: "color-transfer",
    label: "Color Transfer",
    description: "This description must not consume menu space",
    supported_transports: ["shared_memory"],
    params: [],
  },
  {
    id: "image-search",
    label: "Image Search",
    description: "Searches remote images",
    supported_transports: ["shared_memory"],
    params: [],
  },
  {
    id: "neuro.official/custom-stock-monitor",
    label: "股票盯盘",
    description: "Monitors quotes through stock-api",
    supported_transports: ["shared_memory", "websocket"],
    params: [],
  },
  ...Array.from({ length: 10 }, (_, index): ArtCapability => ({
    id: `fixture-art-${index}`,
    label: `Fixture Art ${index}`,
    description: `Fixture description ${index}`,
    supported_transports: ["shared_memory"],
    params: [],
  })),
];

const renderMenu = (callbacks: {
  onAddNode?: (artId: string) => void;
  onClose?: () => void;
} = {}) => {
  const host = document.createElement("div");
  document.body.append(host);
  return render(
    () => (
      <UnitAddNodeMenu
        availableArts={arts}
        onAddNode={callbacks.onAddNode ?? (() => undefined)}
        onClose={callbacks.onClose}
        showActions
        currentPos={{ x: 400, y: 300 }}
      />
    ),
    host,
  );
};

const installScrollMetrics = (
  scrollContainer: HTMLDivElement,
  scrollTrack: HTMLDivElement,
) => {
  let scrollTopValue = 0;
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTopValue,
    set: (value: number) => {
      scrollTopValue = value;
    },
  });
  Object.defineProperty(scrollContainer, "clientHeight", {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(scrollContainer, "scrollHeight", {
    configurable: true,
    value: 520,
  });
  Object.defineProperty(scrollTrack, "clientHeight", {
    configurable: true,
    value: 220,
  });
  vi.spyOn(scrollTrack, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 7,
    bottom: 220,
    width: 7,
    height: 220,
    toJSON: () => ({}),
  });
  scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
  return {
    getScrollTop: () => scrollTopValue,
  };
};

describe("UnitAddNodeMenu compact search and scrolling", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("removes the menu title and Art descriptions while filtering by a partial name", async () => {
    const dispose = renderMenu();
    const search = document.querySelector("[data-add-art-search]") as HTMLInputElement | null;

    expect(search).toBeInstanceOf(HTMLInputElement);
    expect(document.body.textContent).not.toContain("Add Art Node");
    expect(document.body.textContent).not.toContain("This description must not consume menu space");
    expect(document.body.textContent).not.toContain("Searches remote images");

    search!.value = "trans";
    search!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await Promise.resolve();

    const visibleArts = [...document.querySelectorAll("[data-add-art-id]")]
      .map((element) => element.getAttribute("data-add-art-id"));
    expect(visibleArts).toEqual(["color-transfer"]);

    dispose();
  });

  it("finds and adds the packaged Stock Monitor from Loom capabilities", async () => {
    const onAddNode = vi.fn();
    const dispose = renderMenu({ onAddNode });
    const search = document.querySelector("[data-add-art-search]") as HTMLInputElement;

    search.value = "股票";
    search.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await Promise.resolve();

    const button = document.querySelector(
      '[data-add-art-id="neuro.official/custom-stock-monitor"]',
    ) as HTMLButtonElement | null;
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button!.click();
    expect(onAddNode).toHaveBeenCalledWith("neuro.official/custom-stock-monitor");

    dispose();
  });

  it("applies wheel delta explicitly so overlay wheel events scroll the Art list", () => {
    const dispose = renderMenu();
    const scrollContainer = document.querySelector("[data-add-art-scroll-container]") as HTMLDivElement | null;
    const scrollTrack = document.querySelector("[data-add-art-scrollbar-track]") as HTMLDivElement | null;
    expect(scrollContainer).toBeInstanceOf(HTMLDivElement);
    expect(scrollTrack).toBeInstanceOf(HTMLDivElement);
    const metrics = installScrollMetrics(scrollContainer!, scrollTrack!);

    scrollContainer!.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 96,
    }));

    expect(metrics.getScrollTop()).toBe(96);
    expect(api.focusOverlayWindow).toHaveBeenCalled();

    dispose();
  });

  it("supports clicking the scroll track and dragging the scrollbar thumb", () => {
    const dispose = renderMenu();
    const scrollContainer = document.querySelector("[data-add-art-scroll-container]") as HTMLDivElement | null;
    const scrollTrack = document.querySelector("[data-add-art-scrollbar-track]") as HTMLDivElement | null;
    const scrollThumb = document.querySelector("[data-add-art-scrollbar-thumb]") as HTMLDivElement | null;
    expect(scrollContainer).toBeInstanceOf(HTMLDivElement);
    expect(scrollTrack).toBeInstanceOf(HTMLDivElement);
    expect(scrollThumb).toBeInstanceOf(HTMLDivElement);
    const metrics = installScrollMetrics(scrollContainer!, scrollTrack!);

    scrollTrack!.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      clientY: 110,
    }));
    expect(metrics.getScrollTop()).toBeCloseTo(200, 5);

    scrollThumb!.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      clientY: 40,
    }));
    window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      clientY: 80,
    }));
    const scrollTopAfterDrag = metrics.getScrollTop();
    expect(scrollTopAfterDrag).toBeGreaterThan(200);

    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientY: 80 }));
    window.dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      clientY: 120,
    }));
    expect(metrics.getScrollTop()).toBeCloseTo(scrollTopAfterDrag, 5);

    dispose();
  });

  it("dispatches the selected Art id when a workflow result is clicked", () => {
    const onAddNode = vi.fn();
    const dispose = renderMenu({ onAddNode });
    const button = document.querySelector('[data-add-art-id="color-transfer"]') as HTMLButtonElement | null;

    button!.click();

    expect(onAddNode).toHaveBeenCalledWith("color-transfer");
    dispose();
  });

  it("activates once through the native-overlay synthetic dispatcher", () => {
    const onAddNode = vi.fn();
    const dispose = renderMenu({ onAddNode });
    const button = document.querySelector('[data-add-art-id="color-transfer"]') as HTMLButtonElement;
    const dispatcher = createOverlaySyntheticDispatcher({
      doc: document,
      elementFromPoint: () => button,
      isLinking: () => false,
      getDraggingStickerId: () => null,
      win: window,
    });

    dispatcher.dispatch("mousedown", { x: 120, y: 180, shiftKey: true });
    dispatcher.dispatch("mouseup", { x: 122, y: 181, shiftKey: true });

    expect(onAddNode).toHaveBeenCalledTimes(1);
    expect(onAddNode).toHaveBeenCalledWith("color-transfer");
    expect(api.debugLogEvent).toHaveBeenCalledWith(
      "add-art-menu-activate",
      "art=color-transfer source=mouseup",
    );
    dispose();
  });

  it("activates from the stable window-level native mouseup fallback", () => {
    const onAddNode = vi.fn();
    const dispose = renderMenu({ onAddNode });
    const button = document.querySelector('[data-add-art-id="color-transfer"]') as HTMLButtonElement;

    button.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 120,
      clientY: 180,
    }));
    window.dispatchEvent(new CustomEvent(OVERLAY_GLOBAL_MOUSE_UP_EVENT, {
      detail: { x: 120, y: 180, globalX: 180, globalY: 270 },
    }));
    button.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 120,
      clientY: 180,
    }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));

    expect(onAddNode).toHaveBeenCalledTimes(1);
    expect(onAddNode).toHaveBeenCalledWith("color-transfer");
    expect(api.debugLogEvent).toHaveBeenCalledWith(
      "add-art-menu-activate",
      "art=color-transfer source=native-mouseup",
    );
    dispose();
  });

  it("does not activate when the native mouseup finishes away from the press point", () => {
    const onAddNode = vi.fn();
    const dispose = renderMenu({ onAddNode });
    const button = document.querySelector('[data-add-art-id="color-transfer"]') as HTMLButtonElement;

    button.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 120,
      clientY: 180,
    }));
    window.dispatchEvent(new CustomEvent(OVERLAY_GLOBAL_MOUSE_UP_EVENT, {
      detail: { x: 150, y: 210 },
    }));

    expect(onAddNode).not.toHaveBeenCalled();
    expect(api.debugLogEvent).toHaveBeenCalledWith(
      "add-art-menu-activation-rejected",
      "art=color-transfer source=native-mouseup distance=42.4",
    );
    dispose();
  });

  it("clears a pending activation when native mouseup coordinates are missing", () => {
    const onAddNode = vi.fn();
    const dispose = renderMenu({ onAddNode });
    const button = document.querySelector('[data-add-art-id="color-transfer"]') as HTMLButtonElement;

    button.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      clientX: 120,
      clientY: 180,
    }));
    window.dispatchEvent(new CustomEvent(OVERLAY_GLOBAL_MOUSE_UP_EVENT, {
      detail: {},
    }));
    button.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 120,
      clientY: 180,
    }));

    expect(onAddNode).not.toHaveBeenCalled();
    expect(api.debugLogEvent).toHaveBeenCalledWith(
      "add-art-menu-activation-rejected",
      "art=color-transfer source=native-mouseup reason=missing-coordinates",
    );
    dispose();
  });

  it("publishes the rendered menu bounds to the native hit map", async () => {
    const dispose = renderMenu();
    const menu = document.querySelector("#actions-menu-global") as HTMLDivElement;
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue({
      x: 72,
      y: 96,
      left: 72,
      top: 96,
      right: 322,
      bottom: 396,
      width: 250,
      height: 300,
      toJSON: () => ({}),
    });

    window.dispatchEvent(new Event("resize"));
    await vi.waitFor(() => {
      const dpr = window.devicePixelRatio || 1;
      const published = vi.mocked(api.updatePinRects).mock.calls.some(([rects]) =>
        rects.some((rect) =>
          rect.name === "ACTIONS_MENU" &&
          rect.x === Math.round(72 * dpr) &&
          rect.y === Math.round(96 * dpr) &&
          rect.width === Math.round(250 * dpr) &&
          rect.height === Math.round(300 * dpr)
        ),
      );
      expect(published).toBe(true);
    });
    expect(api.debugLogEvent).toHaveBeenCalledWith(
      "add-art-menu-hit-rect",
      expect.stringContaining("rect=72.0,96.0,250.0,300.0"),
    );
    dispose();
  });

  it("clears a controlled search query with the explicit clear button", async () => {
    const dispose = renderMenu();
    const search = document.querySelector("[data-add-art-search]") as HTMLInputElement;
    search.value = "trans";
    search.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await Promise.resolve();

    const clear = document.querySelector("[data-add-art-clear]") as HTMLButtonElement | null;
    expect(clear).toBeInstanceOf(HTMLButtonElement);
    clear!.click();
    await Promise.resolve();

    expect(search.value).toBe("");
    expect(document.querySelectorAll("[data-add-art-id]")).toHaveLength(arts.length);
    expect(document.activeElement).toBe(search);
    dispose();
  });

  it("closes from the header button, Escape, and Shift+1 while search is focused", () => {
    const onClose = vi.fn();
    const dispose = renderMenu({ onClose });
    const search = document.querySelector("[data-add-art-search]") as HTMLInputElement;
    const close = document.querySelector("[data-add-art-close]") as HTMLButtonElement;

    close.click();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    search.dispatchEvent(escape);
    const toggle = new KeyboardEvent("keydown", {
      key: "1",
      code: "Digit1",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    search.dispatchEvent(toggle);

    expect(onClose).toHaveBeenCalledTimes(3);
    expect(escape.defaultPrevented).toBe(true);
    expect(toggle.defaultPrevented).toBe(true);
    dispose();
  });
});
