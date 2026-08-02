// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

vi.mock("../../src/services/api", () => ({
  api: {
    focusOverlayWindow: vi.fn().mockResolvedValue(undefined),
  },
}));

import { SelectControl } from "../../src/components/params/controls/SelectControl";

describe("SelectControl runtime behavior", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders Loom option labels and emits the original typed value", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(
      () => (
        <SelectControl
          id="quality"
          label="Quality"
          value={1}
          options={[
            { value: 1, label: "Low" },
            { value: 2, label: "High" },
          ]}
          isDisabled={false}
          onChange={onChange}
          onContextMenu={() => undefined}
        />
      ),
      host,
    );

    const select = host.querySelector("select");
    expect(select).toBeInstanceOf(HTMLSelectElement);
    expect(Array.from(select!.options).map((option) => option.textContent)).toEqual([
      "Low",
      "High",
    ]);

    select!.value = "number:2";
    select!.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith(2);
    dispose();
  });
});
