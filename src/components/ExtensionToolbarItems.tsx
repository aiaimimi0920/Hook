import { For, type Component } from "solid-js";

import { extensionCommandRouter } from "../services/extensionCommandRouter";
import { extensionPresentationStore } from "../services/extensionPresentationStore";
import { toolbarButtonLeftBorderClass } from "./stickerTopStripChrome";

/** Renders only generic menu contributions; plugin IDs never enter product UI code. */
export const ExtensionToolbarItems: Component = () => (
    <For each={extensionPresentationStore.toolbarItems().filter((item) => item.available()).slice(0, 8)}>
        {(item) => (
            <button
                type="button"
                class={`${toolbarButtonLeftBorderClass} hook-toolbar-idle w-[50px]`}
                aria-label={item.title}
                title={item.title}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    void extensionCommandRouter.execute(item.commandId).catch((error) => {
                        console.error(`Extension toolbar command ${item.commandId} failed`, error);
                    });
                }}
            >
                <span class="max-w-[42px] truncate px-1 font-mono text-[9px] text-[#d9ff38]">
                    {item.title}
                </span>
            </button>
        )}
    </For>
);
