// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "solid-js/web";
vi.mock("../../src/features/workspace/services/syncService", () => ({ syncService: { performWorkflowSync: vi.fn().mockResolvedValue(undefined), updateBackendRects: vi.fn().mockResolvedValue(undefined) } }));
import { StickerAnnotationLayer } from "../../src/features/stickers/components/StickerAnnotationLayer";
import { graphStore } from "../../src/features/workspace/state/graphStore";
import { setSelectedStickerId, stickerEditHistories, uiActions } from "../../src/features/workspace/state/uiStore";
import { captureStickerEditSnapshot } from "../../src/features/stickers/services/stickerHistory";
import { getAnnotationBounds } from "../../src/features/stickers/services/stickerAnnotationBounds";
import type { StickerTextAnnotation } from "../../src/features/stickers/types/stickerEditing";
import { useShortcuts } from "../../src/platform/desktop/useShortcuts";
import { createAppStickerEditingController } from "../../src/app/appStickerEditingController";

const id = "text-reedit-interaction";
let container: HTMLDivElement;
let host: HTMLElement;
let dispose: () => void;
const unit = () => graphStore.units.find((item) => item.id === id)!;
const elements = () => unit().data.annotationState!.elements;
const input = () => container.querySelector<HTMLInputElement>('[aria-label="输入标注文本"]')!;
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const click = async (x: number, y: number) => {
    host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y }));
    await settle();
    host.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, button: 0, buttons: 0, clientX: x, clientY: y }));
    await settle();
};
const finish = async (value: string, key = "Enter") => {
    input().value = value;
    input().dispatchEvent(new Event("input", { bubbles: true }));
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await settle();
};
const reopen = async () => {
    uiActions.setStickerEditMode("brush"); uiActions.setStickerEditMode("text");
    const bounds = getAnnotationBounds(elements()[0]);
    await click(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
};
beforeEach(() => {
    graphStore.actions.addUnit({ id, type: "sticker", x: 0, y: 0, w: 600, h: 400, params: {}, inputs: [], outputs: [], data: { annotationState: { elements: [], serialCounter: 1 } } });
    setSelectedStickerId(id); uiActions.setActiveStickerEditTarget(id);
    uiActions.setSelectedStickerAnnotation(null); uiActions.clearStickerHistory(id);
    uiActions.setStickerEditMode("text"); uiActions.patchStickerToolSettings({ textSize: 24, textColor: "#ef4444", textFontFamily: "Arial" });
    container = document.createElement("div"); document.body.append(container);
    dispose = render(() => {
        const editing = createAppStickerEditingController({ tauriRuntime: false, createImageUnit: () => "", disposeSurface: vi.fn() });
        useShortcuts({ handlers: { onDelete: editing.deleteSelectedUnitOrAnnotation }, contextProvider: () => "unit-selected" });
        return <StickerAnnotationLayer unitId={id} width={600} height={400} />;
    }, container);
    host = container.querySelector("[data-sticker-interaction-root]")!;
    host.setPointerCapture = vi.fn(); host.releasePointerCapture = vi.fn();
});
afterEach(() => { dispose(); graphStore.actions.removeUnit(id); uiActions.clearStickerHistory(id); uiActions.setSelectedStickerAnnotation(null); container.remove(); });

describe("single-click text reediting in the text tool", () => {
    it("commits before a tool prevents default focus and cancels its draft", async () => {
        await click(40, 100);
        input().value = "失焦提交"; input().dispatchEvent(new Event("input", { bubbles: true }));
        const button = document.createElement("button"); container.append(button);
        button.addEventListener("pointerdown", (event) => { event.preventDefault(); uiActions.setStickerEditMode("select"); });
        button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        await settle();
        expect(input()).toBeNull();
        expect((elements()[0] as StickerTextAnnotation).text).toBe("失焦提交");
        expect(stickerEditHistories[id].past).toHaveLength(1);
    });
    it("commits on keyboard focus departure and window blur only once", async () => {
        await click(40, 100);
        input().value = "离开"; input().dispatchEvent(new Event("input", { bubbles: true }));
        const button = document.createElement("button"); container.append(button); button.focus();
        window.dispatchEvent(new Event("blur")); await settle();
        expect((elements()[0] as StickerTextAnnotation).text).toBe("离开");
        expect(stickerEditHistories[id].past).toHaveLength(1);
    });
    it("places a collapsed caret near the clicked character rather than selecting all", async () => {
        await click(40, 100); await finish("abcdef");
        const text = elements()[0] as StickerTextAnnotation;
        await click(text.x + 1, text.y - 4);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(input().selectionStart).toBe(0); expect(input().selectionEnd).toBe(0);
    });
    it.each(["Delete", "Backspace"])("releases stale field focus so %s deletes only selected text and supports undo", async (key) => {
        await click(40, 100); await finish("删除文字");
        const original = JSON.parse(JSON.stringify(elements()[0]));
        uiActions.setStickerEditMode("select");
        const field = document.createElement("input"); field.type = "number"; container.append(field); field.focus();
        const bounds = getAnnotationBounds(elements()[0]);
        await click(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
        expect(document.activeElement).not.toBe(field);
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
        await settle();
        expect(unit()).toBeDefined(); expect(elements()).toHaveLength(0);
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.undoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(elements()[0]).toEqual(original);
        uiActions.setStickerEditMode("text"); await reopen();
        input().dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true }));
        await settle(); expect(elements()).toHaveLength(1); expect(input()).not.toBeNull();
    });
    it("reopens the existing text and commits without adding another annotation, with undo/redo", async () => {
        await click(40, 100); await finish("原始文字");
        const original = JSON.parse(JSON.stringify(elements()[0])) as StickerTextAnnotation;
        uiActions.patchStickerToolSettings({ textSize: 120, textColor: "#ffffff" });
        await reopen();
        expect(input().value).toBe("原始文字");
        expect(input().style.fontSize).toBe("24px");
        await finish("修改后的文字");
        expect(elements()).toHaveLength(1);
        expect(elements()[0]).toEqual({ ...original, text: "修改后的文字" });
        expect(stickerEditHistories[id].past).toHaveLength(2);
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.undoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect(elements()[0]).toEqual(original);
        graphStore.actions.restoreStickerEditSnapshot(id, uiActions.redoStickerHistory(id, captureStickerEditSnapshot(unit()))!);
        expect((elements()[0] as StickerTextAnnotation).text).toBe("修改后的文字");
    });
    it("cancels edits, preserves no-op history and still creates text on empty space", async () => {
        await click(40, 100); await finish("保留");
        await reopen(); await finish("取消修改", "Escape");
        expect((elements()[0] as StickerTextAnnotation).text).toBe("保留");
        expect(stickerEditHistories[id].past).toHaveLength(1);
        await reopen(); await finish("保留");
        expect(stickerEditHistories[id].past).toHaveLength(1);
        await click(400, 300); expect(input().value).toBe(""); await finish("新增");
        expect(elements()).toHaveLength(2);
    });
});
