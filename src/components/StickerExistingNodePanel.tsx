import type { Component, JSX } from "solid-js";

interface StickerExistingNodePanelProps {
    transformModes: JSX.Element;
    content: JSX.Element;
}

export const StickerExistingNodePanel: Component<StickerExistingNodePanelProps> = (props) => (
    <div class="hook-terminal-shell flex-1 min-w-0 p-2">
        <div class="hook-terminal-caption mb-2 text-[10px] font-semibold text-white/45">已有节点</div>
        {props.transformModes}
        <div class="hook-terminal-shell hook-terminal-shell--soft mt-2 p-2">
            {props.content}
        </div>
    </div>
);
