// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";

vi.mock("../../src/services/api", () => ({
  api: {
    focusOverlayWindow: vi.fn().mockResolvedValue(undefined),
  },
}));

import { StringControl } from "../../src/components/params/controls/StringControl";

describe("StringControl runtime behavior", () => {
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
        <StringControl
          id="query"
          label="Query"
          value=""
          isDisabled={false}
          onChange={onChange}
          onContextMenu={() => undefined}
        />
      ),
      host,
    );

    const input = host.querySelector("input");
    expect(input).toBeInstanceOf(HTMLInputElement);

    input!.value = "日本美女";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onChange).toHaveBeenCalledWith("日本美女", false);

    input!.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(onChange).toHaveBeenLastCalledWith("日本美女", true);

    dispose();
  });
});
