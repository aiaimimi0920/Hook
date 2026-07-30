// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

vi.mock("../../src/services/api", () => ({
  api: {
    focusOverlayWindow: vi.fn().mockResolvedValue(undefined),
    readImageFromPath: vi.fn(),
  },
}));

import { UnitParamsPanel } from "../../src/components/UnitParamsPanel";
import { graphStore } from "../../src/store/graphStore";
import type { ArtCapability } from "../../src/services/protocol";
import type { Unit } from "../../src/types/unit";

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  (globalThis as { ResizeObserver?: typeof ResizeObserverMock }).ResizeObserver =
    ResizeObserverMock;
});

const LARGE_CAPABILITY: ArtCapability = {
  id: "color-transfer",
  label: "Color Transfer",
  description: "Overlay-safe scroll fixture",
  supported_transports: ["shared_memory"],
  params: Array.from({ length: 18 }, (_, index) => ({
    id: `slider_${index}`,
    label: `Slider ${index}`,
    widget: "slider",
    default: index,
    min: 0,
    max: 100,
    step: 1,
  })),
  inputs: [{ name: "input_image", label: "Input", type: "image" }],
  outputs: [{ name: "output_image", label: "Image", type: "image" }],
};

const LARGE_UNIT: Unit = {
  id: "node-large-scroll",
  type: "art",
  artId: "color-transfer",
  x: 40,
  y: 60,
  w: 320,
  h: 220,
  params: Object.fromEntries(
    LARGE_CAPABILITY.params.map((param, index) => [param.id, index]),
  ),
  inputs: [],
  outputs: [],
  data: {
    previewSrc: "",
    executionConfig: {
      triggerMode: { upstreamDriven: true, paramDriven: true },
      propagation: { listenUpstream: true, notifyDownstream: true },
    },
  },
};

describe("UnitParamsPanel manual scrolling", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    graphStore.setUnits([]);
    graphStore.setLinks([]);
    graphStore.setCapabilities([]);
    graphStore.setUnitParams({});
    graphStore.setUnitExecConfig({});
    vi.clearAllMocks();
  });

  it("applies wheel delta through JS so overlay-synthetic wheel events can move the parameter list", () => {
    graphStore.setUnits([LARGE_UNIT]);
    graphStore.setLinks([]);
    graphStore.setCapabilities([LARGE_CAPABILITY]);
    graphStore.setUnitParams({
      [LARGE_UNIT.id]: LARGE_UNIT.params,
    });

    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <UnitParamsPanel
          unit={LARGE_UNIT}
          params={graphStore.unitParams[LARGE_UNIT.id] || {}}
          execConfig={{
            triggerMode: { upstreamDriven: true, paramDriven: true },
            propagation: { listenUpstream: true, notifyDownstream: true },
            __expanded: false,
          }}
          capability={LARGE_CAPABILITY}
          connectedLinks={[]}
          onParamChange={() => undefined}
          onLinkStart={() => undefined}
          onLinkDrop={() => undefined}
          onLinkHover={() => undefined}
          onAddNode={() => undefined}
        />
      ),
      host,
    );

    const scrollContainer = host.querySelector(
      ".param-scroll-container",
    ) as HTMLDivElement | null;
    expect(scrollContainer).toBeInstanceOf(HTMLDivElement);

    let scrollTopValue = 0;
    Object.defineProperty(scrollContainer!, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(scrollContainer!, "clientHeight", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(scrollContainer!, "scrollHeight", {
      configurable: true,
      value: 520,
    });

    scrollContainer!.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 96,
      }),
    );

    expect(scrollTopValue).toBe(96);

    dispose();
  });

  it("stops scrollbar thumb dragging when mouseup is released inside the parameter panel", () => {
    graphStore.setUnits([LARGE_UNIT]);
    graphStore.setLinks([]);
    graphStore.setCapabilities([LARGE_CAPABILITY]);
    graphStore.setUnitParams({
      [LARGE_UNIT.id]: LARGE_UNIT.params,
    });

    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <UnitParamsPanel
          unit={LARGE_UNIT}
          params={graphStore.unitParams[LARGE_UNIT.id] || {}}
          execConfig={{
            triggerMode: { upstreamDriven: true, paramDriven: true },
            propagation: { listenUpstream: true, notifyDownstream: true },
            __expanded: false,
          }}
          capability={LARGE_CAPABILITY}
          connectedLinks={[]}
          onParamChange={() => undefined}
          onLinkStart={() => undefined}
          onLinkDrop={() => undefined}
          onLinkHover={() => undefined}
          onAddNode={() => undefined}
        />
      ),
      host,
    );

    const scrollContainer = host.querySelector(
      ".param-scroll-container",
    ) as HTMLDivElement | null;
    const scrollThumb = host.querySelector(
      "[data-param-scrollbar-thumb]",
    ) as HTMLDivElement | null;
    expect(scrollContainer).toBeInstanceOf(HTMLDivElement);
    expect(scrollThumb).toBeInstanceOf(HTMLDivElement);

    let scrollTopValue = 0;
    Object.defineProperty(scrollContainer!, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(scrollContainer!, "clientHeight", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(scrollContainer!, "scrollHeight", {
      configurable: true,
      value: 520,
    });

    scrollContainer!.dispatchEvent(new Event("scroll", { bubbles: true }));

    scrollThumb!.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        clientY: 20,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientY: 60,
      }),
    );
    const scrollTopAfterMove = scrollTopValue;

    scrollThumb!.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        clientY: 60,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientY: 100,
      }),
    );

    expect(scrollTopAfterMove).toBeGreaterThan(0);
    expect(scrollTopValue).toBeCloseTo(scrollTopAfterMove, 5);

    dispose();
  });

  it("keeps the custom scrollbar thumb fully inside the visual track even when the track is shorter than the scroll viewport", () => {
    graphStore.setUnits([LARGE_UNIT]);
    graphStore.setLinks([]);
    graphStore.setCapabilities([LARGE_CAPABILITY]);
    graphStore.setUnitParams({
      [LARGE_UNIT.id]: LARGE_UNIT.params,
    });

    const host = document.createElement("div");
    document.body.append(host);

    const dispose = render(
      () => (
        <UnitParamsPanel
          unit={LARGE_UNIT}
          params={graphStore.unitParams[LARGE_UNIT.id] || {}}
          execConfig={{
            triggerMode: { upstreamDriven: true, paramDriven: true },
            propagation: { listenUpstream: true, notifyDownstream: true },
            __expanded: false,
          }}
          capability={LARGE_CAPABILITY}
          connectedLinks={[]}
          onParamChange={() => undefined}
          onLinkStart={() => undefined}
          onLinkDrop={() => undefined}
          onLinkHover={() => undefined}
          onAddNode={() => undefined}
        />
      ),
      host,
    );

    const scrollContainer = host.querySelector(
      ".param-scroll-container",
    ) as HTMLDivElement | null;
    const scrollTrack = host.querySelector(
      "[data-param-scrollbar-track]",
    ) as HTMLDivElement | null;
    const scrollThumb = host.querySelector(
      "[data-param-scrollbar-thumb]",
    ) as HTMLDivElement | null;

    expect(scrollContainer).toBeInstanceOf(HTMLDivElement);
    expect(scrollTrack).toBeInstanceOf(HTMLDivElement);
    expect(scrollThumb).toBeInstanceOf(HTMLDivElement);

    let scrollTopValue = 60;
    Object.defineProperty(scrollContainer!, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(scrollContainer!, "clientHeight", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(scrollContainer!, "scrollHeight", {
      configurable: true,
      value: 180,
    });
    Object.defineProperty(scrollTrack!, "clientHeight", {
      configurable: true,
      value: 96,
    });

    scrollContainer!.dispatchEvent(new Event("scroll", { bubbles: true }));

    const thumbHeight = Number.parseFloat(scrollThumb!.style.height || "0");
    const thumbTop = Number.parseFloat(scrollThumb!.style.top || "0");

    expect(thumbHeight).toBeGreaterThan(0);
    expect(thumbTop).toBeGreaterThanOrEqual(0);
    expect(thumbTop + thumbHeight).toBeLessThanOrEqual(96);

    dispose();
  });
});
