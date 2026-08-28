import { For, Show, type Component } from "solid-js";

import { ocrToolOptions } from "./stickerTopStripCatalog";
import { ChevronDownCornerIcon } from "./stickerTopStripIcons";
import {
    toolbarButtonLeftBorderClass,
    toolbarCornerToggleClass,
    toolbarMenuClass,
    toolbarMenuItemClass,
    type TopStripOpenMenu,
} from "./stickerTopStripChrome";

interface StickerTopStripOcrToolsProps {
    openMenu: TopStripOpenMenu;
    canCopyFullText: boolean;
    onToggleMenu: (menu: "ocr") => void;
    onCopyFullText: () => void;
}

/** Presents the extensible OCR action category without owning recognition state. */
export const StickerTopStripOcrTools: Component<StickerTopStripOcrToolsProps> = (props) => {
    const toggleMenu = (event: MouseEvent) => {
        event.stopPropagation();
        props.onToggleMenu("ocr");
    };

    return (
        <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
            <button
                type="button"
                class={toolbarButtonLeftBorderClass}
                classList={{
                    "hook-toolbar-button--active": props.openMenu === "ocr",
                    "hook-toolbar-idle": props.openMenu !== "ocr",
                }}
                aria-label="OCR 工具"
                aria-haspopup="menu"
                aria-expanded={props.openMenu === "ocr"}
                title="OCR 工具"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={toggleMenu}
            >
                <span class="font-mono text-[10px] font-bold tracking-[0.08em] text-[#d9ff38]">OCR</span>
            </button>
            <button
                type="button"
                class={toolbarCornerToggleClass}
                aria-label="展开 OCR 工具列表"
                title="展开 OCR 工具列表"
                onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onClick={toggleMenu}
            >
                <ChevronDownCornerIcon class="h-3 w-3" />
            </button>
            <Show when={props.openMenu === "ocr"}>
                <div
                    class={toolbarMenuClass}
                    data-top-strip-menu="true"
                    role="menu"
                    onPointerMove={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >
                    <For each={ocrToolOptions}>
                        {(item) => (
                            <button
                                type="button"
                                class={`${toolbarMenuItemClass} disabled:cursor-not-allowed disabled:opacity-40`}
                                classList={{ "hook-toolbar-menu-item--idle": true }}
                                disabled={!props.canCopyFullText}
                                role="menuitem"
                                title={props.canCopyFullText ? item.title : "请先按 Ctrl+2 重新识别当前贴图"}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    if (item.id === "copy-full-text") props.onCopyFullText();
                                }}
                            >
                                <span class="font-mono text-[10px] text-[#d9ff38]">TXT</span>
                                <span>{item.label}</span>
                            </button>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
};
