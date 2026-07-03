import { Component, For, Show } from "solid-js";

import { graphStore } from "../store/graphStore";
import { activeStickerGroupId, selectionActions, uiActions } from "../store/uiStore";
import { syncService } from "../services/syncService";

export const StickerGroupBar: Component = () => {
    const groups = () => graphStore.stickerGroups;

    return (
        <Show when={groups().length > 0}>
            <div
                class="hook-terminal-shell hook-terminal-shell--strong absolute left-4 top-4 z-[1150] flex items-center gap-2 px-3 py-2 text-[11px]"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <span class="text-white/60">分组</span>
                <button
                    class="hook-terminal-btn px-2 py-1"
                    classList={{
                        "hook-terminal-btn--active": !activeStickerGroupId(),
                    }}
                    onClick={() => uiActions.setActiveStickerGroup(null)}
                >
                    全部
                </button>

                <For each={groups()}>
                    {(group) => (
                        <button
                            class="hook-terminal-btn px-2 py-1"
                            classList={{
                                "hook-terminal-btn--active": activeStickerGroupId() === group.id,
                                "opacity-50": !!group.hidden,
                            }}
                            onClick={() => uiActions.setActiveStickerGroup(group.id)}
                            title={`${group.name}${group.locked ? " (已锁定)" : ""}${group.hidden ? " (已隐藏)" : ""}`}
                        >
                            {group.name}
                        </button>
                    )}
                </For>

                <Show when={activeStickerGroupId()}>
                    <button
                        class="hook-terminal-btn px-2 py-1"
                        onClick={() => {
                            const current = groups().find((group) => group.id === activeStickerGroupId());
                            if (!current) return;
                            const nextName = window.prompt("重命名贴图组", current.name)?.trim();
                            if (!nextName || nextName === current.name) return;
                            graphStore.actions.addOrUpdateStickerGroup({
                                ...current,
                                name: nextName,
                            });
                            void syncService.performWorkflowSync();
                        }}
                    >
                        重命名组
                    </button>

                    <button
                        class="hook-terminal-btn hook-terminal-btn--danger px-2 py-1"
                        onClick={() => {
                            const groupId = activeStickerGroupId();
                            if (!groupId) return;
                            const group = groups().find((item) => item.id === groupId);
                            if (!group) return;
                            const confirmed = window.confirm(`删除贴图组“${group.name}”？组内贴图会变成未分组。`);
                            if (!confirmed) return;
                            graphStore.actions.deleteStickerGroup(groupId);
                            uiActions.setActiveStickerGroup(null);
                            void syncService.performWorkflowSync();
                        }}
                    >
                        删除组
                    </button>

                    <button
                        class="hook-terminal-btn px-2 py-1"
                        onClick={() => {
                            const groupId = activeStickerGroupId();
                            if (!groupId) return;
                            const group = groups().find((item) => item.id === groupId);
                            if (!group) return;
                            const confirmed = window.confirm(`关闭贴图组“${group.name}”？组内贴图会全部关闭。`);
                            if (!confirmed) return;
                            const removedUnitIds = graphStore.actions.closeStickerGroup(groupId);
                            removedUnitIds.forEach((id) => uiActions.clearStickerHistory(id));
                            selectionActions.clear();
                            uiActions.hideStickerToolbar();
                            uiActions.setActiveStickerGroup(null);
                            void syncService.performWorkflowSync();
                        }}
                    >
                        关闭组
                    </button>
                </Show>
            </div>
        </Show>
    );
};
