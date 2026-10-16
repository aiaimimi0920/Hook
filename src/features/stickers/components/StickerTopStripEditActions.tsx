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
    section: "control" | "canvas";
    openMenu: TopStripOpenMenu;
    supportsBitmapTools: boolean;
    isArt: boolean;
    isEraserSelected: boolean;
    isCropSelected: boolean;
    canUndo: boolean;
    canRedo: boolean;
    currentRasterizeScope: StickerRasterizeScope;
    isRasterizeEnabled: boolean;
    canRasterizeSelected: boolean;
    canRasterizeAll: boolean;
    onToggleMenu: (menu: Exclude<TopStripOpenMenu, null>) => void;
    onCanvasTool: (mode: TopStripCanvasTool) => void;
    onHistoryAction: (mode: HistoryActionMode) => void;
    onRasterize: (scope: StickerRasterizeScope) => void;
    onSelectRasterizeScope: (scope: StickerRasterizeScope) => void;
}

/** Renders edit actions while the parent retains mutation and async ownership. */
export const StickerTopStripEditActions: Component<StickerTopStripEditActionsProps> = (props) => {
    const currentRasterizeOption = createMemo(
        () => rasterizeScopeOptions.find((item) => item.mode === props.currentRasterizeScope) ?? rasterizeScopeOptions[0],
    );

    return (
        <>
            <Show when={props.section === "canvas" && props.supportsBitmapTools}>
                <div class="relative h-7 w-7" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        class={toolbarButtonLeftBorderClass}
                        classList={{
                            "otter-toolbar-button--active": props.isEraserSelected,
                            "otter-toolbar-idle": !props.isEraserSelected,
                        }}
                        aria-label="橡皮擦工具"
                        title="橡皮擦"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => props.onCanvasTool("content-eraser")}
                    >
                        <EraserToolIcon class="h-[18px] w-[18px]" />
                    </button>
                </div>
            </Show>

            <Show when={props.section === "canvas" && (props.supportsBitmapTools || props.isArt)}>
                <div class="relative h-7 w-7" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        class={toolbarButtonLeftBorderClass}
                        classList={{
                            "otter-toolbar-button--active": props.isCropSelected,
                            "otter-toolbar-idle": !props.isCropSelected,
                        }}
                        aria-label="裁剪工具"
                        title="裁剪"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => props.onCanvasTool("crop")}
                    >
                        <CropToolIcon class="h-[18px] w-[18px]" />
                    </button>
                </div>
            </Show>

            <Show when={props.section === "control"}>
                <For each={historyActionOptions}>
                    {(item) => (
                        <button
                            type="button"
                            class={toolbarButtonLeftBorderClass}
                            aria-label={item.label}
                            title={item.label}
                            disabled={item.mode === "undo" ? !props.canUndo : !props.canRedo}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => props.onHistoryAction(item.mode)}
                        >
                            <item.Icon class="h-[18px] w-[18px]" />
                        </button>
                    )}
                </For>
            </Show>

            <Show when={props.section === "control" && props.supportsBitmapTools}>
                <div class="relative h-7 w-7" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        class={toolbarButtonLeftBorderClass}
                        classList={{
                            "otter-toolbar-idle": props.isRasterizeEnabled,
                            "otter-toolbar-disabled": !props.isRasterizeEnabled,
                        }}
                        aria-label={currentRasterizeOption().label}
                        title={currentRasterizeOption().label}
                        disabled={!props.isRasterizeEnabled}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => props.onRasterize(props.currentRasterizeScope)}
                    >
                        {(() => {
                            const Icon = currentRasterizeOption().Icon;
                            return <Icon class="h-[18px] w-[18px]" />;
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
                                                "otter-toolbar-menu-item--active":
                                                    props.currentRasterizeScope === item.mode,
                                                "otter-toolbar-menu-item--idle":
                                                    props.currentRasterizeScope !== item.mode && enabled,
                                                "otter-toolbar-disabled": !enabled,
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
