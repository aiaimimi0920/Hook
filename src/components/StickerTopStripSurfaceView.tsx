import { For, Show, type Component } from "solid-js";

import { ChevronDownCornerIcon } from "./stickerTopStripIcons";
import {
    toolbarButtonLeftBorderClass,
    toolbarCornerToggleClass,
    toolbarMenuClass,
    toolbarMenuItemClass,
    type TopStripOpenMenu,
} from "./stickerTopStripChrome";
import type { SurfaceViewDefinition } from "../services/surfaceProtocol";

interface StickerTopStripSurfaceViewProps {
    isArt: boolean;
    openMenu: TopStripOpenMenu;
    surfaceViews: readonly SurfaceViewDefinition[];
    selectedSurfaceViewId?: string;
    onToggleMenu: (menu: "view") => void;
    onSurfaceViewChange?: (viewId: string) => void;
}

/** Presents Art surface selection without owning the selected surface state. */
export const StickerTopStripSurfaceView: Component<StickerTopStripSurfaceViewProps> = (props) => {
    const selectedSurfaceView = () => props.surfaceViews.find((view) => view.id === props.selectedSurfaceViewId);

    return (
        <Show when={props.isArt}>
            <div
                class="relative h-[50px] w-[50px]"
                data-art-view-selector="true"
                onPointerDown={(event) => event.stopPropagation()}
            >
                <button
                    type="button"
                    class={toolbarButtonLeftBorderClass}
                    classList={{
                        "hook-toolbar-button--active": props.openMenu === "view",
                        "hook-toolbar-idle": props.openMenu !== "view",
                    }}
                    aria-label="Art 视图"
                    title={`Art 视图：${selectedSurfaceView()?.label ?? "未声明"}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        props.onToggleMenu("view");
                    }}
                >
                    <span class="font-mono text-[10px] font-bold tracking-[0.08em] text-[#d9ff38]">VIEW</span>
                </button>
                <button
                    type="button"
                    class={toolbarCornerToggleClass}
                    aria-label="展开 Art 视图列表"
                    title="展开 Art 视图列表"
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        props.onToggleMenu("view");
                    }}
                >
                    <ChevronDownCornerIcon class="h-3 w-3" />
                </button>
                <Show when={props.openMenu === "view"}>
                    <div
                        class={toolbarMenuClass}
                        data-top-strip-menu="true"
                        onPointerMove={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <Show
                            when={props.surfaceViews.length > 0}
                            fallback={<div class="px-3 py-2 text-[11px] text-white/55">此 Art 未声明可切换视图</div>}
                        >
                            <For each={props.surfaceViews}>
                                {(view) => (
                                    <button
                                        type="button"
                                        class={toolbarMenuItemClass}
                                        classList={{
                                            "hook-toolbar-menu-item--active": props.selectedSurfaceViewId === view.id,
                                            "hook-toolbar-menu-item--idle": props.selectedSurfaceViewId !== view.id,
                                        }}
                                        onClick={() => props.onSurfaceViewChange?.(view.id)}
                                    >
                                        <span class="min-w-0 flex-1 truncate">{view.label}</span>
                                        <span class="hook-toolbar-shortcut ml-auto text-[10px]">
                                            {view.fullSize.width}×{view.fullSize.height}
                                        </span>
                                    </button>
                                )}
                            </For>
                        </Show>
                    </div>
                </Show>
            </div>
        </Show>
    );
};
