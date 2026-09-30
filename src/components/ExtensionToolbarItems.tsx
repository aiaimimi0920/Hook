import { For, Show, createEffect, createMemo, createSignal, type Component } from "solid-js";

import { extensionCommandRouter } from "../services/extensionCommandRouter";
import {
    extensionPresentationStore,
    visibleExtensionToolbarSlots,
} from "../services/extensionPresentationStore";
import { ChevronDownCornerIcon } from "./stickerTopStripIcons";
import {
    toolbarButtonLeftBorderClass,
    toolbarCornerToggleClass,
    toolbarMenuClass,
    toolbarMenuItemClass,
} from "./stickerTopStripChrome";

const execute = (commandId: string) => {
    void extensionCommandRouter.execute(commandId).catch((error) => {
        console.error(`Extension toolbar command ${commandId} failed`, error);
    });
};

interface ExtensionToolbarItemsProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Renders only generic menu contributions; plugin IDs never enter product UI code. */
export const ExtensionToolbarItems: Component<ExtensionToolbarItemsProps> = (props) => {
    const [openSlotId, setOpenSlotId] = createSignal<string>();
    const slots = createMemo(() => visibleExtensionToolbarSlots(extensionPresentationStore.toolbarItems()).slice(0, 8));
    createEffect(() => {
        if (!props.open) setOpenSlotId(undefined);
    });
    const toggleSlot = (slotId: string) => {
        const next = openSlotId() === slotId ? undefined : slotId;
        setOpenSlotId(next);
        props.onOpenChange(!!next);
    };
    return (
        <For each={slots()}>
            {(slot) => (
                <Show when={slot.grouped} fallback={(
                    <button
                        type="button"
                        class={`${toolbarButtonLeftBorderClass} hook-toolbar-idle w-[50px]`}
                        aria-label={slot.items[0].title}
                        title={slot.items[0].available()
                            ? slot.items[0].title
                            : slot.items[0].disabledTitle ?? `${slot.items[0].title} 当前不可用`}
                        disabled={!slot.items[0].available()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            execute(slot.items[0].commandId);
                        }}
                    >
                        <span class="max-w-[42px] truncate px-1 font-mono text-[9px] text-[#d9ff38]">
                            {slot.items[0].title}
                        </span>
                    </button>
                )}>
                    <div class="relative h-[50px] w-[50px]" onPointerDown={(event) => event.stopPropagation()}>
                        <button
                            type="button"
                            class={toolbarButtonLeftBorderClass}
                            classList={{
                                "hook-toolbar-button--active": openSlotId() === slot.id,
                                "hook-toolbar-idle": openSlotId() !== slot.id,
                            }}
                            aria-label={`${slot.title} 工具`}
                            aria-haspopup="menu"
                            aria-expanded={openSlotId() === slot.id}
                            title={`${slot.title} 工具`}
                            onClick={(event) => {
                                event.stopPropagation();
                                toggleSlot(slot.id);
                            }}
                        >
                            <span class="max-w-[42px] truncate px-1 font-mono text-[9px] font-bold text-[#d9ff38]">
                                {slot.title}
                            </span>
                        </button>
                        <button
                            type="button"
                            class={toolbarCornerToggleClass}
                            aria-label={`展开 ${slot.title} 工具列表`}
                            title={`展开 ${slot.title} 工具列表`}
                            onPointerDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                                toggleSlot(slot.id);
                            }}
                        >
                            <ChevronDownCornerIcon class="h-3 w-3" />
                        </button>
                        <Show when={openSlotId() === slot.id}>
                            <div
                                class={toolbarMenuClass}
                                data-top-strip-menu="true"
                                role="menu"
                                onPointerMove={(event) => event.stopPropagation()}
                                onWheel={(event) => event.stopPropagation()}
                            >
                                <For each={slot.items}>
                                    {(item) => (
                                        <button
                                            type="button"
                                            class={`${toolbarMenuItemClass} hook-toolbar-menu-item--idle disabled:cursor-not-allowed disabled:opacity-40`}
                                            disabled={!item.available()}
                                            role="menuitem"
                                            title={item.available() ? item.title : item.disabledTitle ?? `${item.title} 当前不可用`}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setOpenSlotId(undefined);
                                                props.onOpenChange(false);
                                                execute(item.commandId);
                                            }}
                                        >
                                            <span>{item.title}</span>
                                        </button>
                                    )}
                                </For>
                            </div>
                        </Show>
                    </div>
                </Show>
            )}
        </For>
    );
};
