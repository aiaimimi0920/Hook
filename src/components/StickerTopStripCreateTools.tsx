import { For, Show, type Component, createMemo } from "solid-js";

import { TRANSFORM_MODE_BUTTONS } from "./stickerToolbarModel";
import {
    effectToolOptions,
    labelToolOptions,
    lineToolOptions,
    shapeToolOptions,
    transformModeOptions,
    type EffectCreateTool,
    type LabelCreateTool,
    type ShapeCreateTool,
    type TopStripCreateTool,
} from "./stickerTopStripCatalog";
import { BrushToolIcon, ChevronDownCornerIcon, LineToolIcon } from "./stickerTopStripIcons";
import {
    toolbarButtonClass,
    toolbarButtonRightBorderClass,
    toolbarCornerToggleClass,
    toolbarMenuClass,
    toolbarMenuItemClass,
    type TopStripOpenMenu,
} from "./stickerTopStripChrome";
import type { StickerTransformMode } from "../types/stickerEditing";

interface StickerTopStripCreateToolsProps {
    openMenu: TopStripOpenMenu;
    currentTransformMode: StickerTransformMode;
    currentShapeTool: ShapeCreateTool;
    currentLabelTool: LabelCreateTool;
    currentEffectTool: EffectCreateTool;
    isModeSelected: boolean;
    isShapeSelected: boolean;
    isLineSelected: boolean;
    isBrushSelected: boolean;
    isLabelSelected: boolean;
    isEffectSelected: boolean;
    supportsBitmapTools: boolean;
    onToggleMenu: (menu: Exclude<TopStripOpenMenu, null>) => void;
    onTransformMode: (mode: StickerTransformMode) => void;
    onCreateTool: (mode: TopStripCreateTool) => void;
}

/** Renders the create-tool groups without owning graph or toolbar state. */
export const StickerTopStripCreateTools: Component<StickerTopStripCreateToolsProps> = (props) => {
    const currentTransformOption = createMemo(
        () => transformModeOptions.find((item) => item.mode === props.currentTransformMode) ?? transformModeOptions[0],
    );
    const currentShapeOption = createMemo(
        () => shapeToolOptions.find((item) => item.mode === props.currentShapeTool) ?? shapeToolOptions[0],
    );
    const currentLabelOption = createMemo(
        () => labelToolOptions.find((item) => item.mode === props.currentLabelTool) ?? labelToolOptions[0],
    );
    const currentEffectOption = createMemo(
        () => effectToolOptions.find((item) => item.mode === props.currentEffectTool) ?? effectToolOptions[0],
    );

    return (
        <>
            <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonRightBorderClass}
                    classList={{
                        "hook-toolbar-button--active": props.isModeSelected,
                        "hook-toolbar-idle": !props.isModeSelected,
                    }}
                    aria-label={`${currentTransformOption().label}模式`}
                    title={`${currentTransformOption().label} (${currentTransformOption().shortcut})`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onTransformMode(props.currentTransformMode)}
                >
                    {(() => {
                        const Icon = currentTransformOption().Icon;
                        return <Icon class="h-7 w-7" />;
                    })()}
                </button>
                <button
                    type="button"
                    class={toolbarCornerToggleClass}
                    aria-label="展开模式列表"
                    title="展开模式列表"
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        props.onToggleMenu("mode");
                    }}
                >
                    <ChevronDownCornerIcon class="h-3 w-3" />
                </button>
                <Show when={props.openMenu === "mode"}>
                    <div
                        class={toolbarMenuClass}
                        data-top-strip-menu="true"
                        onPointerMove={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <For each={TRANSFORM_MODE_BUTTONS}>
                            {(item) => {
                                const option =
                                    transformModeOptions.find((candidate) => candidate.mode === item.mode) ??
                                    transformModeOptions[0];
                                return (
                                    <button
                                        type="button"
                                        class={toolbarMenuItemClass}
                                        classList={{
                                            "hook-toolbar-menu-item--active": props.currentTransformMode === item.mode,
                                            "hook-toolbar-menu-idle": props.currentTransformMode !== item.mode,
                                        }}
                                        onClick={() => props.onTransformMode(item.mode)}
                                    >
                                        <option.Icon class="h-4 w-4 shrink-0" />
                                        <span>{item.label}</span>
                                        <span class="hook-toolbar-shortcut ml-auto text-[10px]">{item.shortcut}</span>
                                    </button>
                                );
                            }}
                        </For>
                    </div>
                </Show>
            </div>

            <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonRightBorderClass}
                    classList={{
                        "hook-toolbar-button--active": props.isShapeSelected,
                        "hook-toolbar-idle": !props.isShapeSelected,
                    }}
                    aria-label={`${currentShapeOption().label}图形工具`}
                    title={currentShapeOption().label}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onCreateTool(props.currentShapeTool)}
                >
                    {(() => {
                        const Icon = currentShapeOption().Icon;
                        return <Icon class="h-7 w-7" />;
                    })()}
                </button>
                <button
                    type="button"
                    class={toolbarCornerToggleClass}
                    aria-label="展开图形列表"
                    title="展开图形列表"
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        props.onToggleMenu("shape");
                    }}
                >
                    <ChevronDownCornerIcon class="h-3 w-3" />
                </button>
                <Show when={props.openMenu === "shape"}>
                    <div
                        class={toolbarMenuClass}
                        data-top-strip-menu="true"
                        onPointerMove={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <For each={shapeToolOptions}>
                            {(item) => (
                                <button
                                    type="button"
                                    class={toolbarMenuItemClass}
                                    classList={{
                                        "hook-toolbar-menu-item--active": props.currentShapeTool === item.mode,
                                        "hook-toolbar-menu-idle": props.currentShapeTool !== item.mode,
                                    }}
                                    onClick={() => props.onCreateTool(item.mode)}
                                >
                                    <item.Icon class="h-4 w-4 shrink-0" />
                                    <span>{item.label}</span>
                                </button>
                            )}
                        </For>
                    </div>
                </Show>
            </div>

            <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonClass}
                    classList={{
                        "hook-toolbar-button--active": props.isLineSelected,
                        "hook-toolbar-idle": !props.isLineSelected,
                    }}
                    aria-label="直线工具"
                    title="直线"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onCreateTool("line")}
                >
                    <LineToolIcon class="h-7 w-7" />
                </button>
                <button
                    type="button"
                    class={toolbarCornerToggleClass}
                    aria-label="展开直线列表"
                    title="展开直线列表"
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        props.onToggleMenu("line");
                    }}
                >
                    <ChevronDownCornerIcon class="h-3 w-3" />
                </button>
                <Show when={props.openMenu === "line"}>
                    <div
                        class={toolbarMenuClass}
                        data-top-strip-menu="true"
                        onPointerMove={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <For each={lineToolOptions}>
                            {(item) => (
                                <button
                                    type="button"
                                    class={toolbarMenuItemClass}
                                    classList={{
                                        "hook-toolbar-menu-item--active": props.isLineSelected,
                                        "hook-toolbar-menu-idle": !props.isLineSelected,
                                    }}
                                    onClick={() => props.onCreateTool(item.mode)}
                                >
                                    <item.Icon class="h-4 w-4 shrink-0" />
                                    <span>{item.label}</span>
                                </button>
                            )}
                        </For>
                    </div>
                </Show>
            </div>

            <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonRightBorderClass}
                    classList={{
                        "hook-toolbar-button--active": props.isBrushSelected,
                        "hook-toolbar-idle": !props.isBrushSelected,
                    }}
                    aria-label="画笔工具"
                    title="画笔"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onCreateTool("brush")}
                >
                    <BrushToolIcon class="h-7 w-7" />
                </button>
            </div>

            <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonClass}
                    classList={{
                        "hook-toolbar-button--active": props.isLabelSelected,
                        "hook-toolbar-idle": !props.isLabelSelected,
                    }}
                    aria-label={`${currentLabelOption().label}标记工具`}
                    title={currentLabelOption().label}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onCreateTool(props.currentLabelTool)}
                >
                    {(() => {
                        const Icon = currentLabelOption().Icon;
                        return <Icon class="h-7 w-7" />;
                    })()}
                </button>
                <button
                    type="button"
                    class={toolbarCornerToggleClass}
                    aria-label="展开文字标记列表"
                    title="展开文字标记列表"
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        props.onToggleMenu("label");
                    }}
                >
                    <ChevronDownCornerIcon class="h-3 w-3" />
                </button>
                <Show when={props.openMenu === "label"}>
                    <div
                        class={toolbarMenuClass}
                        data-top-strip-menu="true"
                        onPointerMove={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <For each={labelToolOptions}>
                            {(item) => (
                                <button
                                    type="button"
                                    class={toolbarMenuItemClass}
                                    classList={{
                                        "hook-toolbar-menu-item--active": props.currentLabelTool === item.mode,
                                        "hook-toolbar-menu-idle": props.currentLabelTool !== item.mode,
                                    }}
                                    onClick={() => props.onCreateTool(item.mode)}
                                >
                                    <item.Icon class="h-4 w-4 shrink-0" />
                                    <span>{item.label}</span>
                                </button>
                            )}
                        </For>
                    </div>
                </Show>
            </div>

            <Show when={props.supportsBitmapTools}>
                <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        class={toolbarButtonClass}
                        classList={{
                            "hook-toolbar-button--active": props.isEffectSelected,
                            "hook-toolbar-idle": !props.isEffectSelected,
                        }}
                        aria-label={`${currentEffectOption().label}效果工具`}
                        title={currentEffectOption().label}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => props.onCreateTool(props.currentEffectTool)}
                    >
                        {(() => {
                            const Icon = currentEffectOption().Icon;
                            return <Icon class="h-7 w-7" />;
                        })()}
                    </button>
                    <button
                        type="button"
                        class={toolbarCornerToggleClass}
                        aria-label="展开效果列表"
                        title="展开效果列表"
                        onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            props.onToggleMenu("effect");
                        }}
                    >
                        <ChevronDownCornerIcon class="h-3 w-3" />
                    </button>
                    <Show when={props.openMenu === "effect"}>
                        <div
                            class={toolbarMenuClass}
                            data-top-strip-menu="true"
                            onPointerMove={(event) => event.stopPropagation()}
                            onWheel={(event) => event.stopPropagation()}
                        >
                            <For each={effectToolOptions}>
                                {(item) => (
                                    <button
                                        type="button"
                                        class={toolbarMenuItemClass}
                                        classList={{
                                            "hook-toolbar-menu-item--active": props.currentEffectTool === item.mode,
                                            "hook-toolbar-menu-item--idle": props.currentEffectTool !== item.mode,
                                        }}
                                        onClick={() => props.onCreateTool(item.mode)}
                                    >
                                        <item.Icon class="h-4 w-4 shrink-0" />
                                        <span>{item.label}</span>
                                    </button>
                                )}
                            </For>
                        </div>
                    </Show>
                </div>
            </Show>
        </>
    );
};
