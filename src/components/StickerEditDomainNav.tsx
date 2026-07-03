import type { Component } from "solid-js";
import { For } from "solid-js";

import type { StickerEditingDomain } from "../types/stickerEditing";
import { STICKER_EDITING_DOMAINS } from "./stickerToolbarModel";

interface StickerEditDomainNavProps {
    selected: StickerEditingDomain;
    onSelect: (domain: StickerEditingDomain) => void;
}

export const StickerEditDomainNav: Component<StickerEditDomainNavProps> = (props) => (
    <div class="hook-terminal-shell flex min-w-[104px] flex-col gap-1.5 p-1.5">
        <div class="hook-terminal-caption px-1 text-[10px] font-semibold text-white/45">对象</div>
        <For each={STICKER_EDITING_DOMAINS}>
            {(domain) => (
                <button
                    class="hook-terminal-btn px-2 py-1 text-left"
                    classList={{
                        "hook-terminal-btn--active": props.selected === domain.id,
                    }}
                    onClick={() => props.onSelect(domain.id)}
                    title={domain.description}
                >
                    <div class="text-[11px] font-medium">{domain.label}</div>
                    <div class="mt-0.5 text-[10px] leading-4 text-white/50">{domain.description}</div>
                </button>
            )}
        </For>
    </div>
);
