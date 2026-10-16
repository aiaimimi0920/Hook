// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { NumberControl } from "../../src/features/art/components/params/controls/NumberControl";

vi.mock("../../src/platform/tauri/api", () => ({ api: { focusOverlayWindow: vi.fn().mockResolvedValue(undefined) } }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function mount(value: number, min?: number, max?: number) {
    const change = vi.fn();
    dispose = render(() => <NumberControl id="amount" label="Amount" value={value}
        min={min} max={max} step={1} isDisabled={false} onChange={change} onContextMenu={vi.fn()} />, document.body);
    const track = document.querySelector<HTMLElement>("[data-param-slider-track]")!;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
    return { change, track, input: document.querySelector<HTMLInputElement>("input")! };
}

it("preserves a negative implicit minimum when no min is supplied", () => {
    const { change, track, input } = mount(-25);
    expect(input.value).toBe("-25");
    track.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 0 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 0 }));
    expect(change).toHaveBeenLastCalledWith(-25, true);
});

it("clamps out-of-track dragging and detaches listeners on disposal", () => {
    const { change, track } = mount(0, -10, 10);
    track.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: -50 }));
    expect(change).toHaveBeenLastCalledWith(-10, false);
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 150 }));
    expect(change).toHaveBeenLastCalledWith(10, false);
    dispose?.(); dispose = undefined;
    change.mockClear();
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 50 }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 50 }));
    expect(change).not.toHaveBeenCalled();
});

it("normalizes non-finite current values without publishing a change", () => {
    const { change, input } = mount(Number.NaN, -10, 10);
    expect(input.value).toBe("-10");
    expect(change).not.toHaveBeenCalled();
});
