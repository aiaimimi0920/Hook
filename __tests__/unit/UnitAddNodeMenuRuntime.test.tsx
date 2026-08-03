// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

vi.mock("../../src/services/api", () => ({
  api: {
    focusOverlayWindow: vi.fn().mockResolvedValue(undefined),
  },
}));

import { UnitAddNodeMenu } from "../../src/components/UnitAddNodeMenu";
import { api } from "../../src/services/api";
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
  ...Array.from({ length: 10 }, (_, index): ArtCapability => ({
    id: `fixture-art-${index}`,
    label: `Fixture Art ${index}`,
    description: `Fixture description ${index}`,
    supported_transports: ["shared_memory"],
    params: [],
  })),
];

const renderMenu = () => {
  const host = document.createElement("div");
  document.body.append(host);
  return render(
    () => (
      <UnitAddNodeMenu
        availableArts={arts}
        onAddNode={() => undefined}
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
});
