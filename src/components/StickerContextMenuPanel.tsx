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
    const handleSubmenuMouseEnter = (submenu: Extract<StickerContextSubmenu, "recycleBin" | "referenceLibrary">) =>
        (event: MouseEvent & { currentTarget: HTMLButtonElement; target: Element }) => {
            const rect = event.currentTarget.getBoundingClientRect();
            props.onOpenSubmenu(submenu, { top: rect.top });
        };

    return (
        <div
            class="hook-context-menu-shell flex min-w-[200px] flex-col p-2 text-sm"
            onMouseDown={(event) => event.stopPropagation()}
            onMouseUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            <button
                class="hook-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={() => props.onOpenSubmenu("none")}
                onClick={props.onCloseSticker}
            >
                关闭
            </button>
            <button
                class="hook-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={() => props.onOpenSubmenu("none")}
                onClick={props.onSave}
            >
                保存
            </button>
            <button
                class="hook-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={handleSubmenuMouseEnter("recycleBin")}
            >
                回收站
            </button>
            <button
                class="hook-context-menu-item hook-context-menu-item--danger px-3 py-2 text-left"
                type="button"
                onMouseEnter={() => props.onOpenSubmenu("none")}
                onClick={props.onClearRecycleBin}
            >
                清空回收站
            </button>
            <button
                class="hook-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={() => props.onOpenSubmenu("none")}
                onClick={props.onToggleReference}
            >
                {props.referenceActionLabel}
            </button>
            <button
                class="hook-context-menu-item px-3 py-2 text-left"
                type="button"
                onMouseEnter={handleSubmenuMouseEnter("referenceLibrary")}
            >
                参考列表
            </button>
            <button
                class="hook-context-menu-item hook-context-menu-item--danger px-3 py-2 text-left"
                type="button"
                onMouseEnter={() => props.onOpenSubmenu("none")}
                onClick={props.onClearReferenceLibrary}
            >
                清空参考图
            </button>
        </div>
    );
};
