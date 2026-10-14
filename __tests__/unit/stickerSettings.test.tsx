// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
vi.mock("../../src/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn().mockResolvedValue(undefined), updateBackendRects: vi.fn().mockResolvedValue(undefined) } }));
import { StickerSettings } from "../../src/components/StickerSettings";
import { graphStore } from "../../src/store/graphStore";
import { stickerEditHistories, uiActions } from "../../src/store/uiStore";
import { extraRects } from "../../src/services/uiRegistry";
import { captureStickerEditSnapshot } from "../../src/services/stickerHistory";
import { useShortcuts } from "../../src/hooks/useShortcuts";

const id = "settings-test";
let host: HTMLDivElement;
let dispose: () => void;
const unit = () => graphStore.units.find((u) => u.id === id)!;
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const input = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const panel = () => document.querySelector<HTMLElement>('[aria-label="贴图设置面板"]');
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const enter = (label: string, value: string) => {
    const field = input(label); field.value = value; field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
};
beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    graphStore.actions.addUnit({ id, type: "sticker", x: 100, y: 200, w: 560, h: 350, params: {}, inputs: [], outputs: [], data: {} });
    uiActions.clearStickerHistory(id); uiActions.setStickerEditMode("select");
    host = document.createElement("div"); document.body.append(host);
    dispose = render(() => <StickerSettings unitId={id} x={unit().x} y={unit().y} width={unit().w} height={unit().h} onOpen={() => {}} />, host);
    button("贴图设置").click();
});
afterEach(() => { dispose(); host.remove(); graphStore.actions.removeUnit(id); uiActions.clearStickerHistory(id); vi.unstubAllGlobals(); });

describe("unit settings using existing edit commands", () => {
    it("places the icon-only fit action fourth and disables it without an image", () => {
        const actions = panel()!.querySelectorAll(".sticker-settings-actions button");
        expect(Array.from(actions, (item) => item.getAttribute("aria-label"))).toEqual(["水平镜像", "垂直镜像", "外边框", "合拢外框"]);
        expect(button("合拢外框").textContent).toBe("");
        expect(button("合拢外框").querySelector("svg")).not.toBeNull();
        expect(button("合拢外框").disabled).toBe(true);
    });
    it("fits the current image ratio with undo and detaches pending loads on close", () => {
        const images: Array<{ onload: (() => void) | null }> = [];
        vi.stubGlobal("Image", class {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            naturalWidth = 400; naturalHeight = 200; src = "";
            constructor() { images.push(this); }
        });
        graphStore.actions.updateUnitData(id, { src: "data:image/png;base64,FIT" });
        button("合拢外框").click(); images[0].onload?.();
        expect(unit().w).toBe(560); expect(unit().h).toBe(280);
        expect(unit().x).toBe(100); expect(unit().y).toBe(200);
        expect(stickerEditHistories[id].past).toHaveLength(1);
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.undoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(unit().h).toBe(350);
        button("合拢外框").click(); button("贴图设置").click();
        expect(images[1].onload).toBeNull();
    });
    it("has no close or reset-crop control and toggles from its own entry", () => {
        expect(panel()).not.toBeNull(); expect(button("关闭贴图设置")).toBeNull();
        expect(document.body.textContent).not.toContain("重置裁剪");
        expect(input("等比高度").readOnly).toBe(true);
        button("贴图设置").click(); expect(panel()).toBeNull();
    });
    it("commits proportional sizing, opacity, radius and border with undo", () => {
        enter("宽度", "640"); expect(unit().w).toBe(640); expect(unit().h).toBe(400);
        expect(input("等比高度").value).toBe("400");
        enter("不透明度", "50"); expect(unit().data.opacityNormal).toBe(0.5);
        enter("圆角", "24"); expect(unit().data.imageEditState?.cornerRadius).toBe(24);
        button("外边框").click(); expect(unit().data.imageEditState?.borderWidth).toBeGreaterThan(0);
        expect(stickerEditHistories[id].past).toHaveLength(4);
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.undoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(unit().data.imageEditState?.borderWidth ?? 0).toBe(0);
    });
    it("preserves numeric bounds, stepping and mirrored axes", async () => {
        enter("宽度", "99999"); expect(unit().w).toBe(8192);
        enter("不透明度", "200"); expect(unit().data.opacityNormal ?? 1).toBe(1);
        enter("圆角", "999"); expect(unit().data.imageEditState?.cornerRadius).toBe(128);
        button("减少圆角").click(); expect(unit().data.imageEditState?.cornerRadius).toBe(127);
        button("水平镜像").click(); await settle(); expect(unit().data.imageEditState?.flippedX).toBe(true);
        button("垂直镜像").click(); await settle(); expect(unit().data.imageEditState?.flippedY).toBe(true);
    });
    it("registers and cleans native interaction rectangles without consuming Escape", async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(extraRects().some((rect) => rect.id === `sticker-settings-${id}`)).toBe(true);
        const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
        input("宽度").dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false); expect(panel()).not.toBeNull();
        button("贴图设置").click();
        expect(extraRects().some((rect) => rect.id === `sticker-settings-${id}`)).toBe(false);
        button("贴图设置").click(); uiActions.setStickerEditMode("crop"); expect(panel()).toBeNull();
    });
    it.each(["panel", "input", "button"])("lets global Escape close the sticker from a settings %s", async (target) => {
        const closeSticker = vi.fn();
        const shortcutHost = document.createElement("div");
        document.body.append(shortcutHost);
        const stopShortcuts = render(() => {
            useShortcuts({ handlers: { onDelete: closeSticker }, contextProvider: () => "unit-selected" });
            return null;
        }, shortcutHost);
        try {
            await settle();
            const element = target === "input" ? input("宽度") : target === "button" ? button("水平镜像") : panel()!;
            element.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
            expect(closeSticker).not.toHaveBeenCalled();
            element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
            expect(closeSticker).toHaveBeenCalledTimes(1);
        } finally { stopShortcuts(); shortcutHost.remove(); }
    });
});
