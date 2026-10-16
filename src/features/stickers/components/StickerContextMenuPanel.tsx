import type { StickerContextSubmenu } from "../services/stickerContextMenuController";

interface StickerContextMenuPanelProps {
    referenceActionLabel: string;
    onCloseSticker: () => void;
    onSave: () => void;
    onClearRecycleBin: () => void;
    onToggleReference: () => void;
    onClearReferenceLibrary: () => void;
    onOpenSubmenu: (submenu: StickerContextSubmenu, anchor?: { top: number }) => void;
}

export const StickerContextMenuPanel = (props: StickerContextMenuPanelProps) => {
    const openSubmenuFromEvent = (
        submenu: Exclude<StickerContextSubmenu, "none">,
        event: Event & { currentTarget: HTMLButtonElement; target: Element },
    ) => {
        const rect = event.currentTarget.getBoundingClientRect();
        props.onOpenSubmenu(submenu, { top: rect.top });
    };

    return (
        <div
            class="otter-context-menu-shell flex min-w-[200px] flex-col p-2 text-sm"
            onMouseDown={(event) => event.stopPropagation()}
            onMouseUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            <button
                class="otter-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={() => props.onOpenSubmenu("none")}
                onClick={() => props.onSave()}
            >
                保存
            </button>
            <button
                class="otter-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={() => props.onOpenSubmenu("none")}
                onClick={() => props.onCloseSticker()}
            >
                关闭
            </button>
            <button
                class="otter-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={(event) => openSubmenuFromEvent("recycleBin", event)}
                data-sticker-submenu="recycleBin"
            >
                回收站
            </button>
            <button
                class="otter-context-menu-item otter-context-menu-item--danger px-3 py-2 text-left"
                type="button"
                onMouseEnter={() => props.onOpenSubmenu("none")}
                onClick={() => props.onClearRecycleBin()}
            >
                清空回收站
            </button>
            <div role="separator" class="mx-3 my-1 border-t border-[var(--neuro-line)]" />
            <button
                class="otter-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={() => props.onOpenSubmenu("none")}
                onClick={() => props.onToggleReference()}
            >
                {props.referenceActionLabel}
            </button>
            <button
                class="otter-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={(event) => openSubmenuFromEvent("referenceLibrary", event)}
                data-sticker-submenu="referenceLibrary"
            >
                收藏夹
            </button>
            <button
                class="otter-context-menu-item otter-context-menu-item--danger px-3 py-2 text-left"
                type="button"
                onMouseEnter={() => props.onOpenSubmenu("none")}
                onClick={() => props.onClearReferenceLibrary()}
            >
                清空收藏夹
            </button>
            <div role="separator" class="mx-3 my-1 border-t border-[var(--neuro-line)]" />
            <button
                class="otter-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={(event) => openSubmenuFromEvent("clipboard", event)}
                data-sticker-submenu="clipboard"
                onFocus={(event) => openSubmenuFromEvent("clipboard", event)}
            >
                剪贴板
            </button>
        </div>
    );
};
