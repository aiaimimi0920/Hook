import { For, Show, createEffect, createSignal, onCleanup, type Accessor, type Component } from "solid-js";
import { Portal } from "solid-js/web";

import { loadInstalledStickerFonts } from "../services/installedStickerFontLoader";
import { acceptsSurfaceRelayedKeydown } from "../services/surfaceHostKeydown";
import { syncTopStripBackendRects } from "../services/stickerTopStripSync";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import type { MiniDropdownOption } from "./stickerTopStripPropertyBarFields";

export interface PropertyBarAnchorRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface OpenMiniDropdownMenu {
    id: string;
    anchor: PropertyBarAnchorRect;
    width: number;
    options: MiniDropdownOption[];
    value: string;
    onSelect: (value: string) => void;
}

interface CreatePropertyDropdownControllerOptions {
    unitId: Accessor<string>;
    focusOverlayWindow: () => Promise<void>;
}

/** Owns dropdown portal geometry, global listeners, and deferred font discovery. */
export const createPropertyDropdownController = (options: CreatePropertyDropdownControllerOptions) => {
    const [openDropdownMenu, setOpenDropdownMenu] = createSignal<OpenMiniDropdownMenu | null>(null);
    const dropdownRectId = () => `sticker-top-strip-property-dropdown-${options.unitId()}`;
    let openDropdownMenuRef: HTMLDivElement | undefined;
    let dropdownRectSyncRafIds: number[] = [];
    let lastDropdownBounds: { left: number; top: number; width: number; height: number } | null = null;

    const closeDropdownMenu = () => setOpenDropdownMenu(null);

    const loadInstalledFontsOnDemand = () => {
        void loadInstalledStickerFonts()
            .catch((error) => {
                console.warn("Failed to load installed fonts:", error);
            });
    };

    const toggleDropdownMenu = (
        id: string,
        anchor: PropertyBarAnchorRect,
        width: number,
        optionsList: MiniDropdownOption[],
        value: string,
        onSelect: (value: string) => void,
    ) => {
        setOpenDropdownMenu((current) =>
            current?.id === id
                ? null
                : { id, anchor, width, options: optionsList, value, onSelect },
        );
    };

    const syncOpenDropdownRect = (
        menu: OpenMiniDropdownMenu | null,
        rectId: string,
        dropdownElement: HTMLDivElement | undefined,
    ) => {
        if (!menu || !dropdownElement) return false;
        const bounds = dropdownElement.getBoundingClientRect();
        const nextBounds = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
        if (
            lastDropdownBounds &&
            lastDropdownBounds.left === nextBounds.left &&
            lastDropdownBounds.top === nextBounds.top &&
            lastDropdownBounds.width === nextBounds.width &&
            lastDropdownBounds.height === nextBounds.height
        ) {
            return true;
        }
        lastDropdownBounds = nextBounds;
        addOrUpdateRect({
            id: rectId,
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height,
            name: "STICKER_TOP_STRIP_MENU",
        });
        syncTopStripBackendRects();
        return true;
    };

    const cancelDropdownRectSync = () => {
        for (const rafId of dropdownRectSyncRafIds) window.cancelAnimationFrame(rafId);
        dropdownRectSyncRafIds = [];
    };

    const scheduleDropdownRectSync = (menu: OpenMiniDropdownMenu | null, rectId: string) => {
        if (typeof window === "undefined") return;
        cancelDropdownRectSync();
        const dropdownElement = openDropdownMenuRef;

        const scheduleFrame = (remainingFrames: number) => {
            const rafId = window.requestAnimationFrame(() => {
                dropdownRectSyncRafIds = dropdownRectSyncRafIds.filter((item) => item !== rafId);
                if (!syncOpenDropdownRect(menu, rectId, dropdownElement) && remainingFrames > 0) {
                    scheduleFrame(remainingFrames - 1);
                }
            });
            dropdownRectSyncRafIds.push(rafId);
        };

        scheduleFrame(3);
    };

    createEffect(() => {
        const menu = openDropdownMenu();
        if (typeof window === "undefined" || !menu) return;

        const rectId = dropdownRectId();
        scheduleDropdownRectSync(menu, rectId);
        const handleResize = () => scheduleDropdownRectSync(menu, rectId);
        window.addEventListener("resize", handleResize);
        onCleanup(() => {
            cancelDropdownRectSync();
            openDropdownMenuRef = undefined;
            lastDropdownBounds = null;
            window.removeEventListener("resize", handleResize);
            removeRect(rectId);
            syncTopStripBackendRects();
        });
    });

    createEffect(() => {
        const menu = openDropdownMenu();
        if (typeof window === "undefined" || !menu) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && openDropdownMenuRef?.contains(target)) return;
            if (target instanceof Element) {
                const trigger = target.closest<HTMLElement>("[data-top-strip-popup-trigger]");
                if (trigger?.dataset.topStripPopupTrigger === menu.id) return;
            }
            closeDropdownMenu();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!acceptsSurfaceRelayedKeydown(event, { surfaceRelayed: true })) return;
            if (event.key === "Escape") closeDropdownMenu();
        };

        window.addEventListener("pointerdown", handlePointerDown, true);
        window.addEventListener("keydown", handleKeyDown, true);
        onCleanup(() => {
            window.removeEventListener("pointerdown", handlePointerDown, true);
            window.removeEventListener("keydown", handleKeyDown, true);
        });
    });

    onCleanup(() => {
        cancelDropdownRectSync();
        openDropdownMenuRef = undefined;
        lastDropdownBounds = null;
    });

    const PropertyDropdownPortal: Component = () => (
        <Show when={openDropdownMenu()}>
            {(menu) => (
                <Portal>
                    <div
                        ref={(element) => {
                            openDropdownMenuRef = element;
                            syncOpenDropdownRect(menu(), dropdownRectId(), element);
                        }}
                        data-top-strip-menu="true"
                        data-top-strip-property-popup="true"
                        class="hook-toolbar-menu pointer-events-auto fixed z-[1305] overflow-hidden"
                        style={{
                            left: `${menu().anchor.x}px`,
                            top: `${menu().anchor.y + menu().anchor.height + 4}px`,
                            width: `${menu().width}px`,
                        }}
                        onPointerDown={(event) => {
                            event.stopPropagation();
                            void options.focusOverlayWindow();
                        }}
                        onMouseDown={(event) => {
                            event.stopPropagation();
                            void options.focusOverlayWindow();
                        }}
                        onPointerMove={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <div class="max-h-[220px] overflow-y-auto overflow-x-hidden py-1">
                            <For each={menu().options}>
                                {(option) => (
                                    <button
                                        type="button"
                                        class="hook-toolbar-menu-item flex h-7 w-full items-center px-2 text-left text-[11px] transition-colors"
                                        classList={{
                                            "hook-toolbar-menu-item--active": menu().value === option.value,
                                        }}
                                        title={option.title ?? option.label}
                                        onClick={() => menu().onSelect(option.value)}
                                    >
                                        <span class="truncate">{option.label}</span>
                                    </button>
                                )}
                            </For>
                        </div>
                    </div>
                </Portal>
            )}
        </Show>
    );

    return {
        openDropdownMenu,
        closeDropdownMenu,
        toggleDropdownMenu,
        loadInstalledFontsOnDemand,
        PropertyDropdownPortal,
    };
};
