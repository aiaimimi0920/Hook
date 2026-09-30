import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { OverlayMenuScrollArea } from "../../src/components/OverlayMenuScrollArea";
import { createPropertyDropdownController } from "../../src/components/stickerTopStripPropertyDropdownController";
import { createOverlaySyntheticDispatcher } from "../../src/services/overlaySyntheticEvents";

vi.mock("../../src/services/stickerTopStripSync", () => ({ syncTopStripBackendRects: vi.fn() }));
let dispose: () => void;
const disconnect = vi.fn();
beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect = disconnect; });
});
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const viewport = () => document.querySelector<HTMLDivElement>("[data-overlay-menu-scroll]")!;
const thumb = () => document.querySelector<HTMLDivElement>('[role="scrollbar"]')!;
const layout = (total = 1000) => {
    Object.defineProperties(viewport(), { clientHeight: { value: 200, configurable: true }, scrollHeight: { value: total, configurable: true } });
    viewport().dispatchEvent(new Event("scroll"));
};
const relay = (hit: () => EventTarget) => createOverlaySyntheticDispatcher({
    doc: document, elementFromPoint: hit, isLinking: () => false, getDraggingStickerId: () => null,
});
const mount = () => {
    dispose = render(() => <OverlayMenuScrollArea label="列表滚动条"><button>Last option</button></OverlayMenuScrollArea>, document.body);
    layout();
};

it("scrolls the actual font popup through native wheel relay and selects a later font", () => {
    const select = vi.fn();
    const Fixture = () => {
        const controller = createPropertyDropdownController({ unitId: () => "font-test", focusOverlayWindow: async () => undefined });
        return <><button id="open-font" onClick={() => controller.toggleDropdownMenu("font", { x: 20, y: 40, width: 110, height: 32 }, 196,
            Array.from({ length: 30 }, (_, i) => ({ value: `Font ${i}`, label: `Font ${i}` })), "Font 0", select)}>Font</button>
            <controller.PropertyDropdownPortal /></>;
    };
    dispose = render(Fixture, document.body);
    document.querySelector<HTMLButtonElement>("#open-font")!.click(); layout();
    const last = viewport().querySelectorAll("button")[29];
    const dispatcher = relay(() => last);
    const outerWheel = vi.fn(); window.addEventListener("wheel", outerWheel);
    try {
        dispatcher.dispatch("wheel", { x: 50, y: 100, deltaY: 120 });
        expect(viewport().scrollTop).toBe(120);
        expect(outerWheel).not.toHaveBeenCalled();
        dispatcher.dispatch("wheel", { x: 50, y: 100, deltaY: 10000 });
        expect(viewport().scrollTop).toBe(800);
        dispatcher.dispatch("mousedown", { x: 50, y: 100 });
        dispatcher.dispatch("mouseup", { x: 50, y: 100 });
        expect(select).toHaveBeenCalledWith("Font 29");
    } finally { window.removeEventListener("wheel", outerWheel); }
});

it("normalizes wheel units, prevents the default and contains boundary deltas", () => {
    mount();
    const wheel = (deltaY: number, deltaMode = 0) => {
        const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, deltaMode });
        viewport().dispatchEvent(event); return event;
    };
    expect(wheel(2, 1).defaultPrevented).toBe(true); expect(viewport().scrollTop).toBe(56);
    wheel(1, 2); expect(viewport().scrollTop).toBe(256);
    wheel(-10000); expect(viewport().scrollTop).toBe(0);
    wheel(10000); expect(viewport().scrollTop).toBe(800);
});

it("drags the custom thumb with native relay and supports keyboard and track scrolling", () => {
    mount();
    const dispatcher = relay(thumb);
    dispatcher.dispatch("mousedown", { x: 195, y: 10 });
    dispatcher.dispatch("mousemove", { x: 195, y: 90 });
    expect(viewport().scrollTop).toBe(400);
    dispatcher.dispatch("mouseup", { x: 195, y: 90 });
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 150 }));
    expect(viewport().scrollTop).toBe(400);
    thumb().dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(viewport().scrollTop).toBe(800);
    thumb().dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(viewport().scrollTop).toBe(0);
    thumb().parentElement!.dispatchEvent(new MouseEvent("mousedown", { clientY: 100, bubbles: true }));
    expect(viewport().scrollTop).toBe(400);
});

it("hides the scrollbar for short lists and cleans up an active drag on unmount", () => {
    mount(); layout(100); expect(thumb()).toBeNull();
    layout(); const saved = viewport();
    thumb().dispatchEvent(new MouseEvent("mousedown", { clientY: 10, bubbles: true }));
    const remove = vi.spyOn(window, "removeEventListener");
    dispose();
    expect(disconnect).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith("mousemove", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith("mouseup", expect.any(Function), true);
    window.dispatchEvent(new MouseEvent("mousemove", { clientY: 150 }));
    expect(saved.scrollTop).toBe(0);
});
