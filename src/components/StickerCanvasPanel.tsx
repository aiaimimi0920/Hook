import type { Component, JSX } from "solid-js";

interface StickerCanvasPanelProps {
    categoryButtons: JSX.Element;
    content: JSX.Element;
}

export const StickerCanvasPanel: Component<StickerCanvasPanelProps> = (props) => (
    <div class="hook-terminal-shell flex-1 min-w-0 p-2">
        <div class="hook-terminal-caption mb-2 text-[10px] font-semibold text-white/45">整图处理</div>
        <div class="flex flex-wrap items-center gap-1">{props.categoryButtons}</div>
        <div class="hook-terminal-shell hook-terminal-shell--soft mt-2 p-2">
            {props.content}
        </div>
    </div>
);
