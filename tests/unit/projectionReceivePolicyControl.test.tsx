// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
import { ProjectionReceivePolicyControl } from "../../src/features/projection/components/ProjectionReceivePolicyControl";
import { projectionReceivePolicy, saveProjectionReceivePolicy } from "../../src/features/projection/state/projectionReceivePolicyStore";
import { api } from "../../src/platform/tauri/api";
import { extraRects } from "../../src/platform/desktop/uiRegistry";

vi.mock("../../src/platform/tauri/api", () => ({ api: { focusOverlayWindow: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../../src/features/stickers/services/stickerTopStripSync", () => ({ syncTopStripBackendRects: vi.fn() }));
let dispose: () => void;
const controls = () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="接收策略"]')];
const menu = () => document.querySelector<HTMLElement>('[data-top-strip-property-popup]');
const options = () => [...menu()!.querySelectorAll<HTMLButtonElement>("button")];
const click = (element: HTMLElement) => {
    // Match the untrusted DOM events emitted by the native overlay input relay.
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};
const change = (button: HTMLButtonElement, label: string) => {
    click(button);
    click(options().find((option) => option.textContent === label)!);
};
beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    saveProjectionReceivePolicy("confirm");
    const host = document.createElement("div"); document.body.append(host);
    dispose = render(() => <><ProjectionReceivePolicyControl /><ProjectionReceivePolicyControl /></>, host);
});
afterEach(() => { dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("offers exactly three strategies and updates all panels through one persisted setting", () => {
    click(controls()[0]);
    expect(options().map((option) => option.textContent)).toEqual(["自动", "手动", "拒绝"]);
    click(controls()[0]);
    for (const [policy, label] of [["auto", "自动"], ["reject", "拒绝"], ["confirm", "手动"]]) {
        change(controls()[0], label);
        expect(projectionReceivePolicy()).toBe(policy);
        expect(controls().map((button) => button.textContent)).toEqual([`${label}▾`, `${label}▾`]);
        expect(JSON.parse(localStorage.getItem("otter.projection-receive-policy.v1")!)).toEqual({ version: 1, policy });
        expect(menu()).toBeNull();
    }
});

it("keeps the old consent and reports an error when persistence fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
    change(controls()[0], "自动");
    expect(projectionReceivePolicy()).toBe("confirm");
    expect(controls()[0].textContent).toBe("手动▾");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("保存接收策略失败");
});

it("protects the portal hit region and releases it on outside click, Escape and unmount", () => {
    expect(extraRects()).toHaveLength(0);
    click(controls()[0]);
    expect(controls()[0].getAttribute("aria-expanded")).toBe("true");
    expect(menu()?.parentElement?.closest(".projection-receive-policy")).toBeNull();
    expect(extraRects()).toHaveLength(1);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(menu()).toBeNull();
    expect(extraRects()).toHaveLength(0);
    click(controls()[0]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu()).toBeNull();
    expect(extraRects()).toHaveLength(0);
    click(controls()[0]);
    click(controls()[1]);
    expect(controls().map((button) => button.getAttribute("aria-expanded"))).toEqual(["false", "true"]);
    expect(extraRects()).toHaveLength(1);
    dispose();
    expect(menu()).toBeNull();
    expect(extraRects()).toHaveLength(0);
});

it("focuses the native overlay without starting a parent drag", () => {
    const bubble = vi.fn(); document.body.addEventListener("mousedown", bubble);
    controls()[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(api.focusOverlayWindow).toHaveBeenCalled(); expect(bubble).not.toHaveBeenCalled();
    document.body.removeEventListener("mousedown", bubble);
});
