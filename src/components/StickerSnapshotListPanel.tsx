import { For } from "solid-js";
import type { FrozenStickerEntry } from "../services/stickerSnapshot";

interface StickerSnapshotListPanelProps {
    entries: FrozenStickerEntry[];
    onLeftActivate: (entryId: string) => void;
    onRightActivate: (entryId: string) => void;
}

export const StickerSnapshotListPanel = (props: StickerSnapshotListPanelProps) => (
    <div
        class="hook-context-menu-shell grid w-[236px] grid-cols-3 auto-rows-[72px] gap-[5px] overflow-x-hidden overflow-y-auto p-[5px] min-h-[82px] max-h-[390px]"
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
        }}
    >
        <For each={props.entries}>
            {(entry) => (
                <button
                    class="hook-terminal-list-item flex h-[72px] w-[72px] items-center justify-center overflow-hidden"
                    type="button"
                    onClick={() => props.onLeftActivate(entry.entryId)}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        props.onRightActivate(entry.entryId);
                    }}
                >
                    <img
                        class="h-full w-full object-cover"
                        src={entry.snapshot.previewSrc || entry.snapshot.src}
                        alt=""
                        draggable={false}
                    />
                </button>
            )}
        </For>
    </div>
);
