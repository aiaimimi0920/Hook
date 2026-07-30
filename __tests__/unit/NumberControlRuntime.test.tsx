// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

import { NumberControl } from "../../src/components/params/controls/NumberControl";

describe("NumberControl runtime behavior", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("emits a non-final change while typing before blur commits the final value", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <NumberControl
          id="count"
          label="Count"
          widget="number"
          value={1}
          min={1}
          max={10}
          step={1}
          isDisabled={false}
          onChange={onChange}
          onContextMenu={() => undefined}
        />
      ),
      host,
    );

    const input = host.querySelector("input[type='number']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    input!.value = "2";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith(2, false);

    input!.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(onChange).toHaveBeenLastCalledWith(2, true);

    dispose();
  });

  it("updates slider values through the overlay-safe drag track instead of a native range input", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <NumberControl
          id="strength"
          label="Strength"
          widget="slider"
          value={10}
          min={0}
          max={100}
          step={1}
          isDisabled={false}
          onChange={onChange}
          onContextMenu={() => undefined}
        />
      ),
      host,
    );

    const track = host.querySelector("[data-param-slider-track]");
    const thumb = host.querySelector("[data-param-slider-thumb]");
    const thumbVisual = host.querySelector("[data-param-slider-thumb-visual]");
    expect(track).toBeInstanceOf(HTMLDivElement);
    expect(thumb).toBeInstanceOf(HTMLDivElement);
    expect(thumbVisual).toBeInstanceOf(HTMLDivElement);
    expect(host.querySelector("input[type='range']")).toBeNull();
    expect((thumb as HTMLDivElement).style.width).toBe("20px");
    expect((thumb as HTMLDivElement).style.height).toBe("18px");
    expect((thumbVisual as HTMLDivElement).style.clipPath).toContain("polygon");
    expect((thumbVisual as HTMLDivElement).style.width).toBe("12px");
    expect((thumbVisual as HTMLDivElement).style.height).toBe("8px");

    vi.spyOn(track as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 10,
      top: 10,
      left: 20,
      right: 220,
      bottom: 24,
      width: 200,
      height: 14,
      toJSON: () => ({}),
    } as DOMRect);

    track!.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        clientX: 160,
        clientY: 16,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 180,
        clientY: 16,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        clientX: 180,
        clientY: 16,
      }),
    );

    expect(onChange).toHaveBeenCalledWith(70, false);
    expect(onChange).toHaveBeenLastCalledWith(80, true);

    dispose();
  });

  it("starts dragging from the visible triangle thumb so its hit area matches the marker", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <NumberControl
          id="strength"
          label="Strength"
          widget="slider"
          value={10}
          min={0}
          max={100}
          step={1}
          isDisabled={false}
          onChange={onChange}
          onContextMenu={() => undefined}
        />
      ),
      host,
    );

    const track = host.querySelector("[data-param-slider-track]");
    const thumb = host.querySelector("[data-param-slider-thumb]");
    expect(track).toBeInstanceOf(HTMLDivElement);
    expect(thumb).toBeInstanceOf(HTMLDivElement);
    expect((thumb as HTMLDivElement).style.pointerEvents).not.toBe("none");

    vi.spyOn(track as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 10,
      top: 10,
      left: 20,
      right: 220,
      bottom: 24,
      width: 200,
      height: 14,
      toJSON: () => ({}),
    } as DOMRect);

    thumb!.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        clientX: 160,
        clientY: 12,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 180,
        clientY: 12,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        clientX: 180,
        clientY: 12,
      }),
    );

    expect(onChange).toHaveBeenCalledWith(70, false);
    expect(onChange).toHaveBeenLastCalledWith(80, true);

    dispose();
  });

  it("uses a slightly larger transparent hitbox around the visible triangle and highlights it on hover", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <NumberControl
          id="strength"
          label="Strength"
          widget="slider"
          value={10}
          min={0}
          max={100}
          step={1}
          isDisabled={false}
          onChange={() => undefined}
          onContextMenu={() => undefined}
        />
      ),
      host,
    );

    const thumb = host.querySelector("[data-param-slider-thumb]");
    const thumbVisual = host.querySelector("[data-param-slider-thumb-visual]");
    expect(thumb).toBeInstanceOf(HTMLDivElement);
    expect(thumbVisual).toBeInstanceOf(HTMLDivElement);

    expect((thumb as HTMLDivElement).style.pointerEvents).toBe("auto");
    expect((thumb as HTMLDivElement).style.width).toBe("20px");
    expect((thumb as HTMLDivElement).style.height).toBe("18px");

    const visual = thumbVisual as HTMLDivElement;
    const beforeHoverBackground = visual.style.background;
    const beforeHoverFilter = visual.style.filter;

    thumb!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(visual.style.background).not.toBe(beforeHoverBackground);
    expect(visual.style.filter).not.toBe(beforeHoverFilter);

    thumb!.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));

    expect(visual.style.background).toBe(beforeHoverBackground);

    dispose();
  });

  it("stops slider dragging when mouseup is released inside a parent that stops bubbling", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <div onMouseUp={(event) => event.stopPropagation()}>
          <NumberControl
            id="strength"
            label="Strength"
            widget="slider"
            value={10}
            min={0}
            max={100}
            step={1}
            isDisabled={false}
            onChange={onChange}
            onContextMenu={() => undefined}
          />
        </div>
      ),
      host,
    );

    const track = host.querySelector("[data-param-slider-track]");
    expect(track).toBeInstanceOf(HTMLDivElement);

    vi.spyOn(track as HTMLDivElement, "getBoundingClientRect").mockReturnValue({
      x: 20,
      y: 10,
      top: 10,
      left: 20,
      right: 220,
      bottom: 24,
      width: 200,
      height: 14,
      toJSON: () => ({}),
    } as DOMRect);

    track!.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        clientX: 160,
        clientY: 16,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 180,
        clientY: 16,
      }),
    );
    track!.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        clientX: 180,
        clientY: 16,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 200,
        clientY: 16,
      }),
    );

    expect(onChange).toHaveBeenCalledWith(70, false);
    expect(onChange).toHaveBeenCalledWith(80, false);
    expect(onChange).toHaveBeenCalledWith(80, true);
    expect(onChange).not.toHaveBeenCalledWith(90, false);
    expect(onChange).toHaveBeenLastCalledWith(80, true);

    dispose();
  });

  it("keeps the slider track inset away from the left parameter port hotspot", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <NumberControl
          id="hue_shift"
          label="Hue Shift"
          widget="slider"
          value={0}
          min={-100}
          max={100}
          step={1}
          isDisabled={false}
          onChange={() => undefined}
          onContextMenu={() => undefined}
        />
      ),
      host,
    );

    const sliderRow = host.querySelector("[data-param-slider-row]");
    expect(sliderRow).toBeInstanceOf(HTMLDivElement);
    expect((sliderRow as HTMLDivElement).style.paddingLeft).not.toBe("");
    expect((sliderRow as HTMLDivElement).style.paddingRight).not.toBe("");

    dispose();
  });
});
