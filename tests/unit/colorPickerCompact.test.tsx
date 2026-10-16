// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
vi.mock("../../src/features/workspace/services/syncService", () => ({ syncService: { updateBackendRects: vi.fn(async () => {}) } }));
import { ColorPicker } from "../../src/features/workspace/components/ColorPicker";

let host: HTMLDivElement;
let dispose: () => void;
const change = vi.fn();
const close = vi.fn();
const add = vi.fn();
const remove = vi.fn();
const pick = vi.fn();
const input = (label: string, value: string) => {
    const field = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return field;
};
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div"); document.body.append(host);
    dispose = render(() => <ColorPicker value="#ff3344" onChange={change} onClose={close}
        palette={["transparent", "#123456"]} onAddToPalette={add} onRemoveFromPalette={remove} onPickFromScreen={pick} />, host);
});
afterEach(() => { dispose(); host.remove(); vi.unstubAllGlobals(); });

describe("compact color picker interactions", () => {
    it("copies HEX on primary click and RGB on context click without applying or closing", () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        const preview = button("复制当前颜色 HEX");
        preview.click();
        expect(writeText).toHaveBeenLastCalledWith("#ff3344");
        const context = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        preview.dispatchEvent(context);
        expect(context.defaultPrevented).toBe(true);
        expect(writeText).toHaveBeenLastCalledWith("rgb(255, 51, 68)");
        expect(writeText).toHaveBeenCalledTimes(2);
        expect(change).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });
    it("copies the current alpha in HEX and RGBA instead of the initial color", () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        input("不透明度百分比", "50");
        const preview = button("复制当前颜色 HEX");
        preview.click();
        expect(writeText).toHaveBeenLastCalledWith("#ff334480");
        preview.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        expect(writeText).toHaveBeenLastCalledWith("rgba(255, 51, 68, 0.5)");
    });
    it("tolerates unavailable clipboard and rejected write permission", async () => {
        vi.stubGlobal("navigator", {});
        expect(() => button("复制当前颜色 HEX").click()).not.toThrow();
        const writeText = vi.fn().mockRejectedValue(new Error("Clipboard permission denied"));
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        button("复制当前颜色 HEX").click();
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledOnce();
        expect(close).not.toHaveBeenCalled();
    });
    it("places the add button before every palette color", () => {
        expect(host.querySelector('.otter-color-picker-palette')!.firstElementChild).toBe(button("添加到调色板"));
    });
    it("keeps partial HEX drafts editable and applies an eight-digit color", () => {
        const field = input("HEX 颜色", "#12");
        expect(field.value).toBe("#12");
        input("HEX 颜色", "#12345680");
        host.querySelector<HTMLButtonElement>(".otter-color-picker-apply")!.click();
        expect(change).toHaveBeenCalledWith("#12345680");
        expect(close).toHaveBeenCalledOnce();
    });
    it("edits opacity independently and preserves hue when selecting transparency", () => {
        input("不透明度百分比", "50");
        button("添加到调色板").click();
        expect(add).toHaveBeenLastCalledWith("#ff334480");
        button("透明").click();
        button("添加到调色板").click();
        expect(add).toHaveBeenLastCalledWith("#ff334400");
        input("不透明度百分比", "150");
        button("添加到调色板").click();
        expect(add).toHaveBeenLastCalledWith("#ff3344");
    });
    it("keeps screen picking, palette removal, and cancel available", () => {
        button("屏幕取色").click();
        expect(pick).toHaveBeenCalledOnce();
        button("#123456").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        expect(remove).toHaveBeenLastCalledWith("#123456");
        button("取消").click();
        expect(close).toHaveBeenCalledOnce();
        expect(change).not.toHaveBeenCalled();
    });
    it("closes with Escape without dispatching a canvas shortcut", () => {
        const leaked = vi.fn(); window.addEventListener("keydown", leaked);
        input("HEX 颜色", "#ffffff").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(close).toHaveBeenCalledOnce();
        expect(change).not.toHaveBeenCalled();
        expect(leaked).not.toHaveBeenCalled();
        window.removeEventListener("keydown", leaked);
    });
    it("deletes a palette color using its corner button without selecting or applying it", () => {
        button("删除颜色 #123456").click();
        expect(remove).toHaveBeenCalledWith("#123456");
        expect(change).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        button("添加到调色板").click();
        expect(add).toHaveBeenCalledWith("#ff3344");
        button("删除颜色 transparent").click();
        expect(remove).toHaveBeenLastCalledWith("transparent");
    });
    it("drags alpha without leaking mouse gestures to the sticker", () => {
        const track = host.querySelector<HTMLDivElement>("[data-alpha-slider]")!;
        vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ left: 20, top: 0, width: 200, height: 16 } as DOMRect);
        const leaked = vi.fn(); host.addEventListener("mousedown", leaked);
        track.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 120 }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 170 }));
        window.dispatchEvent(new MouseEvent("mouseup"));
        expect(leaked).not.toHaveBeenCalled();
        expect(host.querySelector<HTMLInputElement>('input[aria-label="不透明度百分比"]')!.value).toBe("75");
        button("添加到调色板").click();
        expect(add).toHaveBeenCalledWith("#ff3344bf");
        expect(host.querySelector<HTMLInputElement>('input[aria-label="HEX 颜色"]')!.value).toBe("#ff3344bf");
    });
});
