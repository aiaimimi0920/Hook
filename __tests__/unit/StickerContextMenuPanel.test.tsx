import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import { StickerContextMenuPanel } from "../../src/components/StickerContextMenuPanel";

describe("sticker context menu actions", () => {
    it("omits QR projection while preserving save and close actions", () => {
        const host = document.createElement("div");
        document.body.append(host);
        const onSave = vi.fn();
        const onCloseSticker = vi.fn();
        const onOpenSubmenu = vi.fn();
        const dispose = render(() => <StickerContextMenuPanel
            referenceActionLabel="收藏"
            onCloseSticker={onCloseSticker}
            onSave={onSave}
            onClearRecycleBin={vi.fn()}
            onToggleReference={vi.fn()}
            onClearReferenceLibrary={vi.fn()}
            onOpenSubmenu={onOpenSubmenu}
        />, host);
        try {
            const buttons = [...host.querySelectorAll("button")];
            expect(buttons.map((button) => button.textContent?.trim())).toEqual([
                "保存", "关闭", "回收站", "清空回收站", "收藏", "收藏夹", "清空收藏夹", "剪贴板",
            ]);
            const separator = host.querySelector('[role="separator"]');
            expect(separator?.previousElementSibling).toBe(buttons[3]);
            expect(separator?.nextElementSibling).toBe(buttons[4]);
            const separators = host.querySelectorAll('[role="separator"]');
            expect(separators).toHaveLength(2);
            expect(separators[1].previousElementSibling).toBe(buttons[6]);
            expect(separators[1].nextElementSibling).toBe(buttons[7]);
            buttons[7].dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
            expect(onOpenSubmenu).toHaveBeenCalledWith("clipboard", { top: 0 });
            buttons[0].click();
            expect(onSave).toHaveBeenCalledOnce();
            expect(onCloseSticker).not.toHaveBeenCalled();
            buttons[1].click();
            expect(onCloseSticker).toHaveBeenCalledOnce();
            expect(onSave).toHaveBeenCalledOnce();
        } finally {
            dispose();
            host.remove();
        }
    });
});
