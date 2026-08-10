import { Component, For, Show } from "solid-js";

import {
    historyState,
    isHistoryPanelOpen,
    uiActions,
} from "../store/uiStore";

interface HistoryPanelProps {
    // Re-add a captured image to the canvas at the canvas center.
    onReuseScreenshot: (thumbnail: string) => void;
}

/**
 * Floating panel listing recent picked colors and captured screenshots.
 * Colors: click copies + sets the active sticker color. Screenshots: click
 * re-adds the (thumbnail) image to the canvas. Both lists are persisted to
 * disk and bounded; see historyModel + the Rust save_history/load_history.
 */
export const HistoryPanel: Component<HistoryPanelProps> = (props) => {
    const colors = () => historyState.colors;
    const screenshots = () => historyState.screenshots;

    const copyColor = async (hex: string) => {
        uiActions.setStickerActiveColor(hex);
        try {
            await navigator.clipboard.writeText(hex);
        } catch (error) {
            console.warn("[HistoryPanel] Failed to copy color to clipboard", error);
        }
    };

    return (
        <Show when={isHistoryPanelOpen()}>
            <div
                class="hook-terminal-shell hook-terminal-shell--strong absolute right-4 top-16 z-[1200] flex max-h-[70vh] w-64 flex-col gap-3 overflow-hidden p-3 text-[11px]"
                onMouseDown={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
            >
                <div class="flex items-center justify-between">
                    <span class="text-[12px] font-semibold text-[var(--theme-text)]">历史记录</span>
                    <button
                        class="hook-terminal-btn px-2 py-0.5"
                        onClick={() => uiActions.setHistoryPanelOpen(false)}
                        title="关闭历史面板"
                    >
                        关闭
                    </button>
                </div>

                <div class="flex flex-col gap-1.5">
                    <span class="hook-history-caption">取色历史</span>
                    <Show
                        when={colors().length > 0}
                        fallback={<span class="hook-history-empty">暂无取色记录</span>}
                    >
                        <div class="flex flex-wrap gap-1.5">
                            <For each={colors()}>
                                {(entry) => (
                                    <button
                                        class="hook-color-swatch h-6 w-6 transition-transform hover:scale-110"
                                        style={{ "background-color": entry.hex }}
                                        title={`${entry.hex} — 点击复制并设为当前颜色`}
                                        onClick={() => void copyColor(entry.hex)}
                                    />
                                )}
                            </For>
                        </div>
                    </Show>
                </div>

                <div class="flex min-h-0 flex-col gap-1.5">
                    <span class="hook-history-caption">截图历史</span>
                    <Show
                        when={screenshots().length > 0}
                        fallback={<span class="hook-history-empty">暂无截图记录</span>}
                    >
                        <div class="grid grid-cols-3 gap-1.5 overflow-y-auto pr-1">
                            <For each={screenshots()}>
                                {(entry) => (
                                    <div class="hook-history-item group relative aspect-square overflow-hidden">
                                        <img
                                            src={entry.thumbnail}
                                            alt="screenshot"
                                            class="h-full w-full cursor-pointer object-cover"
                                            title="点击重新加入画布"
                                            onClick={() => props.onReuseScreenshot(entry.thumbnail)}
                                        />
                                        <button
                                            class="hook-history-remove absolute right-0 top-0 hidden px-1 text-[10px] group-hover:block"
                                            title="从历史中删除"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                if (confirm("确定要删除这条截图记录吗？")) {
                                                    uiActions.removeScreenshotHistory(entry.id);
                                                }
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>
            </div>
        </Show>
    );
};
