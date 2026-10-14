import { For, Show, type Component, type JSX, createMemo } from "solid-js";

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
import { BrushToolIcon, ChevronDownCornerIcon } from "./stickerTopStripIcons";
import {
    toolbarButtonClass,
    toolbarButtonRightBorderClass,
    toolbarCornerToggleClass,
    toolbarMenuClass,
    toolbarMenuItemClass,
    type TopStripOpenMenu,
} from "./stickerTopStripChrome";
import type { StickerTransformMode } from "../types/stickerEditing";

const PaintbrushIcon: Component<{ class?: string }> = (props) => <svg class={props.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="m11 11 8-8a1.4 1.4 0 0 1 2 2l-8 8" />
    <path d="M10 11c-4 0-4 4-5 6-1 2-2 3-3 4 6 1 12-2 12-6 0-2-2-4-4-4Z" fill="currentColor" />
</svg>;

interface StickerTopStripCreateToolsProps {
    controlActions?: JSX.Element;
    canvasActions?: JSX.Element;
    openMenu: TopStripOpenMenu;
    currentTransformMode: StickerTransformMode;
    currentShapeTool: ShapeCreateTool;
    currentLineTool?: "line" | "bezier";
    currentBrushTool?: "brush" | "paintbrush";
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
    const currentLineOption = createMemo(
        () => lineToolOptions.find((item) => item.mode === props.currentLineTool) ?? lineToolOptions[0],
    );
    const currentLabelOption = createMemo(
        () => labelToolOptions.find((item) => item.mode === props.currentLabelTool) ?? labelToolOptions[0],
    );
    const currentEffectOption = createMemo(
        () => effectToolOptions.find((item) => item.mode === props.currentEffectTool) ?? effectToolOptions[0],
    );

    return (
        <>
            <div class="relative h-7 w-7" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonRightBorderClass}
                    classList={{
                        "otter-toolbar-button--active": props.isModeSelected,
                        "otter-toolbar-idle": !props.isModeSelected,
                    }}
                    aria-label={`${currentTransformOption().label}模式`}
                    title={`${currentTransformOption().label} (${currentTransformOption().shortcut})`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onTransformMode(props.currentTransformMode)}
                >
                    {(() => {
                        const Icon = currentTransformOption().Icon;
                        return <Icon class="h-[18px] w-[18px]" />;
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
                        class={`${toolbarMenuClass} otter-mode-menu`}
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
                                            "otter-toolbar-menu-item--active": props.currentTransformMode === item.mode,
                                            "otter-toolbar-menu-idle": props.currentTransformMode !== item.mode,
                                        }}
                                        onClick={() => props.onTransformMode(item.mode)}
                                    >
                                        <option.Icon class="h-4 w-4 shrink-0" />
                                        <span>{item.label}</span>
                                        <span class="otter-toolbar-shortcut ml-auto text-[10px]">{item.shortcut}</span>
                                    </button>
                                );
                            }}
                        </For>
                    </div>
                </Show>
            </div>

            {props.controlActions}
            <span class="otter-edit-strip-divider" aria-hidden="true" />
            <div class="relative h-7 w-7" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonRightBorderClass}
                    classList={{
                        "otter-toolbar-button--active": props.isShapeSelected,
                        "otter-toolbar-idle": !props.isShapeSelected,
                    }}
                    aria-label={`${currentShapeOption().label}图形工具`}
                    data-rectangle-property-anchor="true"
                    title={currentShapeOption().label}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onCreateTool(props.currentShapeTool)}
                >
                    {(() => {
                        const Icon = currentShapeOption().Icon;
                        return <Icon class="h-[18px] w-[18px]" />;
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
                                        "otter-toolbar-menu-item--active": props.currentShapeTool === item.mode,
                                        "otter-toolbar-menu-idle": props.currentShapeTool !== item.mode,
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

            <div class="relative h-7 w-7" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonClass}
                    classList={{
                        "otter-toolbar-button--active": props.isLineSelected,
                        "otter-toolbar-idle": !props.isLineSelected,
                    }}
                    aria-label={`${currentLineOption().label}工具`}
                    title={currentLineOption().label}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onCreateTool(currentLineOption().mode)}
                >
                    {(() => { const Icon = currentLineOption().Icon; return <Icon class="h-[18px] w-[18px]" />; })()}
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
                                        "otter-toolbar-menu-item--active": props.isLineSelected && currentLineOption().mode === item.mode,
                                        "otter-toolbar-menu-idle": !props.isLineSelected || currentLineOption().mode !== item.mode,
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

            <div class="relative h-7 w-7" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonRightBorderClass}
                    classList={{
                        "otter-toolbar-button--active": props.isBrushSelected,
                        "otter-toolbar-idle": !props.isBrushSelected,
                    }}
                    aria-label={props.currentBrushTool === "paintbrush" ? "画笔工具" : "铅笔工具"}
                    title={props.currentBrushTool === "paintbrush" ? "画笔" : "铅笔"}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onCreateTool(props.currentBrushTool ?? "brush")}
                >
                    <Show when={props.currentBrushTool === "paintbrush"} fallback={<BrushToolIcon class="h-[18px] w-[18px]" />}>
                        <PaintbrushIcon class="h-[18px] w-[18px]" />
                    </Show>
                </button>
                <button
                    type="button"
                    class={toolbarCornerToggleClass}
                    aria-label="展开铅笔和画笔列表"
                    title="铅笔 / 画笔"
                    aria-expanded={props.openMenu === "brush"}
                    onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    }}
                    onClick={(event) => {
                        event.stopPropagation();
                        props.onToggleMenu("brush");
                    }}
                >
                    <ChevronDownCornerIcon class="h-3 w-3" />
                </button>
                <Show when={props.openMenu === "brush"}>
                    <div
                        class={toolbarMenuClass}
                        data-top-strip-menu="true"
                        onPointerMove={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <button
                            type="button"
                            class={toolbarMenuItemClass}
                            classList={{ "otter-toolbar-menu-item--active": props.isBrushSelected && props.currentBrushTool !== "paintbrush" }}
                            onClick={() => props.onCreateTool("brush")}
                        >
                            <BrushToolIcon class="h-4 w-4 shrink-0" />
                            <span>铅笔</span>
                        </button>
                        <button
                            type="button"
                            class={toolbarMenuItemClass}
                            classList={{ "otter-toolbar-menu-item--active": props.isBrushSelected && props.currentBrushTool === "paintbrush" }}
                            onClick={() => props.onCreateTool("paintbrush")}
                        >
                            <PaintbrushIcon class="h-4 w-4 shrink-0" />
                            <span>画笔</span>
                        </button>
                    </div>
                </Show>
            </div>

            <div class="relative h-7 w-7" onPointerDown={(event) => event.stopPropagation()}>
                <button
                    type="button"
                    class={toolbarButtonClass}
                    classList={{
                        "otter-toolbar-button--active": props.isLabelSelected,
                        "otter-toolbar-idle": !props.isLabelSelected,
                    }}
                    aria-label={`${currentLabelOption().label}标记工具`}
                    title={currentLabelOption().label}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => props.onCreateTool(props.currentLabelTool)}
                >
                    {(() => {
                        const Icon = currentLabelOption().Icon;
                        return <Icon class="h-[18px] w-[18px]" />;
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
                                        "otter-toolbar-menu-item--active": props.currentLabelTool === item.mode,
                                        "otter-toolbar-menu-idle": props.currentLabelTool !== item.mode,
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
                <div class="relative h-7 w-7" onPointerDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        class={toolbarButtonClass}
                        classList={{
                            "otter-toolbar-button--active": props.isEffectSelected,
                            "otter-toolbar-idle": !props.isEffectSelected,
                        }}
                        aria-label={`${currentEffectOption().label}效果工具`}
                        title={currentEffectOption().label}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => props.onCreateTool(props.currentEffectTool)}
                    >
                        {(() => {
                            const Icon = currentEffectOption().Icon;
                            return <Icon class="h-[18px] w-[18px]" />;
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
                                            "otter-toolbar-menu-item--active": props.currentEffectTool === item.mode,
                                            "otter-toolbar-menu-item--idle": props.currentEffectTool !== item.mode,
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
            {props.canvasActions}
            <span class="otter-edit-strip-divider" aria-hidden="true" />
        </>
    );
};
