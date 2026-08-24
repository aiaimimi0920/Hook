import { For, Show, type Component, createMemo } from "solid-js";

import {
    historyActionOptions,
    rasterizeScopeOptions,
    type HistoryActionMode,
} from "./stickerTopStripCatalog";
import { ChevronDownCornerIcon, CropToolIcon, EraserToolIcon } from "./stickerTopStripIcons";
import {
    toolbarButtonLeftBorderClass,
    toolbarCornerToggleClass,
    toolbarMenuClass,
    toolbarMenuItemClass,
    type TopStripOpenMenu,
} from "./stickerTopStripChrome";
import type { StickerRasterizeScope } from "../services/stickerRasterize";

type TopStripCanvasTool = "crop" | "content-eraser";

interface StickerTopStripEditActionsProps {
    openMenu: TopStripOpenMenu;
    supportsBitmapTools: boolean;
    isArt: boolean;
    isEraserSelected: boolean;
    isCropSelected: boolean;
    currentHistoryAction: HistoryActionMode;
    isHistoryEnabled: boolean;
    canUndo: boolean;
    canRedo: boolean;
    currentRasterizeScope: StickerRasterizeScope;
    isRasterizeEnabled: boolean;
    canRasterizeSelected: boolean;
    canRasterizeAll: boolean;
    onToggleMenu: (menu: Exclude<TopStripOpenMenu, null>) => void;
    onCanvasTool: (mode: TopStripCanvasTool) => void;
    onHistoryAction: (mode: HistoryActionMode) => void;
    onSelectHistoryAction: (mode: HistoryActionMode) => void;
    onRasterize: (scope: StickerRasterizeScope) => void;
    onSelectRasterizeScope: (scope: StickerRasterizeScope) => void;
}

/** Renders edit actions while the parent retains mutation and async ownership. */
export const StickerTopStripEditActions: Component<StickerTopStripEditActionsProps> = (props) => {
    const currentHistoryOption = createMemo(
        () => historyActionOptions.find((item) => item.mode === props.currentHistoryAction) ?? historyActionOptions[0],
    );
    const currentRasterizeOption = createMemo(
        () => rasterizeScopeOptions.find((item) => item.mode === props.currentRasterizeScope) ?? rasterizeScopeOptions[0],
    );

    return (
        <>
            <Show when={props.supportsBitmapTools}>
                <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        class={toolbarButtonLeftBorderClass}
                        classList={{
                            "hook-toolbar-button--active": props.isEraserSelected,
                            "hook-toolbar-idle": !props.isEraserSelected,
                        }}
                        aria-label="橡皮擦工具"
                        title="橡皮擦"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => props.onCanvasTool("content-eraser")}
                    >
                        <EraserToolIcon class="h-7 w-7" />
                    </button>
                </div>
            </Show>

            <Show when={props.supportsBitmapTools || props.isArt}>
                <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        class={toolbarButtonLeftBorderClass}
                        classList={{
                            "hook-toolbar-button--active": props.isCropSelected,
                            "hook-toolbar-idle": !props.isCropSelected,
                        }}
                        aria-label="裁剪工具"
                        title="裁剪"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => props.onCanvasTool("crop")}
                    >
                        <CropToolIcon class="h-7 w-7" />
                    </button>
                </div>
            </Show>

            <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonLeftBorderClass}
                    classList={{
                        "hook-toolbar-idle": props.isHistoryEnabled,
                        "hook-toolbar-disabled": !props.isHistoryEnabled,
                    }}
                    aria-label={currentHistoryOption().label}
                    title={currentHistoryOption().label}
                    disabled={!props.isHistoryEnabled}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onHistoryAction(props.currentHistoryAction)}
                >
                    {(() => {
                        const Icon = currentHistoryOption().Icon;
                        return <Icon class="h-7 w-7" />;
                    })()}
                </button>
                <button
                    type="button"
                    class={toolbarCornerToggleClass}
                    aria-label="展开历史操作列表"
                    title="展开历史操作列表"
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        props.onToggleMenu("history");
                    }}
                >
                    <ChevronDownCornerIcon class="h-3 w-3" />
                </button>
                <Show when={props.openMenu === "history"}>
                    <div
                        class={toolbarMenuClass}
                        data-top-strip-menu="true"
                        onPointerMove={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <For each={historyActionOptions}>
                            {(item) => {
                                const enabled = item.mode === "undo" ? props.canUndo : props.canRedo;
                                return (
                                    <button
                                        type="button"
                                        class={toolbarMenuItemClass}
                                        classList={{
                                            "hook-toolbar-menu-item--active": props.currentHistoryAction === item.mode,
                                            "hook-toolbar-menu-item--idle":
                                                props.currentHistoryAction !== item.mode && enabled,
                                            "hook-toolbar-disabled": !enabled,
                                        }}
                                        onClick={() => props.onSelectHistoryAction(item.mode)}
                                    >
                                        <item.Icon class="h-4 w-4 shrink-0" />
                                        <span>{item.label}</span>
                                    </button>
                                );
                            }}
                        </For>
                    </div>
                </Show>
            </div>

            <Show when={props.supportsBitmapTools}>
                <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        class={toolbarButtonLeftBorderClass}
                        classList={{
                            "hook-toolbar-idle": props.isRasterizeEnabled,
                            "hook-toolbar-disabled": !props.isRasterizeEnabled,
                        }}
                        aria-label={currentRasterizeOption().label}
                        title={currentRasterizeOption().label}
                        disabled={!props.isRasterizeEnabled}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => props.onRasterize(props.currentRasterizeScope)}
                    >
                        {(() => {
                            const Icon = currentRasterizeOption().Icon;
                            return <Icon class="h-7 w-7" />;
                        })()}
                    </button>
                    <button
                        type="button"
                        class={toolbarCornerToggleClass}
                        aria-label="展开栅格化列表"
                        title="展开栅格化列表"
                        onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            props.onToggleMenu("rasterize");
                        }}
                    >
                        <ChevronDownCornerIcon class="h-3 w-3" />
                    </button>
                    <Show when={props.openMenu === "rasterize"}>
                        <div
                            class={toolbarMenuClass}
                            data-top-strip-menu="true"
                            onPointerMove={(event) => event.stopPropagation()}
                            onWheel={(event) => event.stopPropagation()}
                        >
                            <For each={rasterizeScopeOptions}>
                                {(item) => {
                                    const enabled =
                                        item.mode === "selected" ? props.canRasterizeSelected : props.canRasterizeAll;
                                    return (
                                        <button
                                            type="button"
                                            class={toolbarMenuItemClass}
                                            classList={{
                                                "hook-toolbar-menu-item--active":
                                                    props.currentRasterizeScope === item.mode,
                                                "hook-toolbar-menu-item--idle":
                                                    props.currentRasterizeScope !== item.mode && enabled,
                                                "hook-toolbar-disabled": !enabled,
                                            }}
                                            onClick={() => props.onSelectRasterizeScope(item.mode)}
                                        >
                                            <item.Icon class="h-4 w-4 shrink-0" />
                                            <span>{item.label}</span>
                                        </button>
                                    );
                                }}
                            </For>
                        </div>
                    </Show>
                </div>
            </Show>
        </>
    );
};
