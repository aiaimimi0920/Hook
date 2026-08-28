// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

import { StickerTopStripOcrTools } from "../../src/components/StickerTopStripOcrTools";

describe("StickerTopStripOcrTools", () => {
    let dispose: (() => void) | undefined;
    let host: HTMLDivElement;

    beforeEach(() => {
        host = document.createElement("div");
        document.body.append(host);
    });

    afterEach(() => {
        dispose?.();
        host.remove();
    });

    it("opens the OCR category and enables cached full-copy without changing the menu shell", async () => {
        const copyFullText = vi.fn();
        let setCanCopy: (value: boolean) => void = () => undefined;
        dispose = render(() => {
            const [openMenu, setOpenMenu] = createSignal<"ocr" | null>(null);
            const [canCopy, updateCanCopy] = createSignal(false);
            setCanCopy = updateCanCopy;
            return (
                <StickerTopStripOcrTools
                    openMenu={openMenu()}
                    canCopyFullText={canCopy()}
                    onToggleMenu={(menu) => setOpenMenu((current) => current === menu ? null : menu)}
                    onCopyFullText={copyFullText}
                />
            );
        }, host);

        host.querySelector<HTMLButtonElement>("[aria-label='OCR 工具']")!.click();
        const menu = host.querySelector<HTMLElement>("[data-top-strip-menu='true']");
        const copyButton = Array.from(menu!.querySelectorAll("button"))
            .find((button) => button.textContent?.includes("复制全文")) as HTMLButtonElement;
        expect(menu?.getAttribute("role")).toBe("menu");
        expect(copyButton.disabled).toBe(true);
        expect(copyButton.title).toContain("Ctrl+2");

        setCanCopy(true);
        await vi.waitFor(() => expect(copyButton.disabled).toBe(false));
        copyButton.click();
        expect(copyFullText).toHaveBeenCalledOnce();
    });
});
