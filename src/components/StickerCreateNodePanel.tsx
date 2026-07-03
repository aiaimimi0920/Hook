import type { Component, JSX } from "solid-js";

interface StickerCreateNodePanelProps {
    categoryButtons: JSX.Element;
    toolButtons: JSX.Element;
    content: JSX.Element;
}

export const StickerCreateNodePanel: Component<StickerCreateNodePanelProps> = (props) => (
    <div class="hook-terminal-shell flex-1 min-w-0 p-2">
        <div class="hook-terminal-caption mb-2 text-[10px] font-semibold text-white/45">新建节点</div>
        <div class="flex flex-wrap items-center gap-1">{props.categoryButtons}</div>
        <div class="mt-2 flex flex-wrap items-center gap-1">{props.toolButtons}</div>
        <div class="hook-terminal-shell hook-terminal-shell--soft mt-2 p-2">
            {props.content}
        </div>
    </div>
);
