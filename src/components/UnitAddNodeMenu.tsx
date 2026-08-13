
import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { Unit } from "../types/unit";
import { ArtCapability } from "../services/protocol";
import { api } from "../services/api";
import { syncService } from "../services/syncService";
import { ShortcutManager } from "../services/shortcuts";
import {
    OVERLAY_GLOBAL_MOUSE_UP_EVENT,
    type OverlaySyntheticMousePayload,
} from "../services/overlaySyntheticEvents";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";
import {
    registerDragFollowerElement,
    unregisterDragFollowerElement,
} from "../services/dragFollowerRegistry";

interface UnitAddNodeMenuProps {
  unit?: Unit;
  availableArts?: ArtCapability[];
  onAddNode: (artId: string) => void;
  onClose?: () => void;
  showActions: boolean;
  currentPos: { x: number; y: number };
}

export const UnitAddNodeMenu: Component<UnitAddNodeMenuProps> = (props) => {
    let menuRootRef: HTMLDivElement | undefined;
    let scrollContainerRef: HTMLDivElement | undefined;
    let scrollTrackRef: HTMLDivElement | undefined;
    let searchInputRef: HTMLInputElement | undefined;
    let dragFollowerRegistration: { unitId: string; element: HTMLDivElement } | null = null;
    let scrollThumbDragCleanup: (() => void) | undefined;
    let menuRectSyncRafId: number | null = null;
    let suppressClickArtId: string | null = null;
    let suppressClickTimer: number | null = null;
    let pendingArtActivation: {
        artId: string;
        clientX: number;
        clientY: number;
    } | null = null;
    let lastLoggedMenuRect = "";
    let lastSearchQuery = "";
    const [searchQuery, setSearchQuery] = createSignal("");
    const [scrollMetrics, setScrollMetrics] = createSignal({
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        trackHeight: 0,
    });

    const syncDragFollowerRegistration = () => {
        const unitId = props.unit?.id;
        const shouldRegister = !!unitId && props.showActions && !props.unit?.data.minified;
        const element = shouldRegister ? menuRootRef : undefined;
        const registration = dragFollowerRegistration;

        if (registration && (registration.unitId !== unitId || registration.element !== element)) {
            unregisterDragFollowerElement(registration.unitId, registration.element);
            dragFollowerRegistration = null;
        }
        if (!unitId || !element || dragFollowerRegistration) return;

        registerDragFollowerElement(unitId, element);
        dragFollowerRegistration = { unitId, element };
    };

    const filteredArts = createMemo(() => {
        const query = searchQuery().trim().toLocaleLowerCase();
        const arts = props.availableArts || [];
        if (!query) return arts;
        return arts.filter((art) =>
            [art.label, art.id]
                .filter((value): value is string => typeof value === "string")
                .some((value) => value.toLocaleLowerCase().includes(query)),
        );
    });

    const closeMenu = (event?: Event) => {
        event?.preventDefault();
        event?.stopPropagation();
        props.onClose?.();
    };

    const clearSearch = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        setSearchQuery("");
        searchInputRef?.focus();
    };

    const handleSearchKeyDown = (event: KeyboardEvent) => {
        const togglesMenu = ShortcutManager.matchesShortcutEvent("toggle-actions", event);
        if (event.key === "Escape" || togglesMenu) {
            closeMenu(event);
        }
    };

    const syncScrollMetrics = () => {
        if (!scrollContainerRef) return;
        const trackHeight =
            scrollTrackRef?.clientHeight ||
            scrollTrackRef?.getBoundingClientRect().height ||
            scrollContainerRef.clientHeight;
        setScrollMetrics({
            scrollTop: scrollContainerRef.scrollTop,
            scrollHeight: scrollContainerRef.scrollHeight,
            clientHeight: scrollContainerRef.clientHeight,
            trackHeight,
        });
    };

    const getMaxScrollTop = () =>
        Math.max(0, scrollMetrics().scrollHeight - scrollMetrics().clientHeight);

    const setManualScrollTop = (nextScrollTop: number) => {
        if (!scrollContainerRef) return;
        const maxScrollTop = Math.max(0, scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight);
        scrollContainerRef.scrollTop = Math.max(0, Math.min(nextScrollTop, maxScrollTop));
        syncScrollMetrics();
    };

    const hasScrollableOverflow = () => scrollMetrics().scrollHeight > scrollMetrics().clientHeight + 1;
    const getScrollTrackHeight = () =>
        scrollMetrics().trackHeight > 0 ? scrollMetrics().trackHeight : scrollMetrics().clientHeight;
    const getScrollThumbHeight = () => {
        const metrics = scrollMetrics();
        const trackHeight = getScrollTrackHeight();
        if (trackHeight <= 0 || metrics.clientHeight <= 0 || metrics.scrollHeight <= 0) return 0;
        if (!hasScrollableOverflow()) return trackHeight;
        return Math.min(trackHeight, Math.max(18, (metrics.clientHeight / metrics.scrollHeight) * trackHeight));
    };
    const getScrollThumbTravel = () => Math.max(0, getScrollTrackHeight() - getScrollThumbHeight());
    const getScrollThumbTop = () => {
        const maxScrollTop = getMaxScrollTop();
        return maxScrollTop > 0
            ? (scrollMetrics().scrollTop / maxScrollTop) * getScrollThumbTravel()
            : 0;
    };

    const clearScrollThumbDrag = () => {
        scrollThumbDragCleanup?.();
        scrollThumbDragCleanup = undefined;
    };

    const startScrollThumbDrag = (event: MouseEvent & { currentTarget: HTMLDivElement }) => {
        event.preventDefault();
        event.stopPropagation();
        void api.focusOverlayWindow();
        const dragStartClientY = event.clientY;
        const dragStartScrollTop = scrollContainerRef?.scrollTop ?? scrollMetrics().scrollTop;
        const maxScrollTop = getMaxScrollTop();
        const thumbTravel = getScrollThumbTravel();
        if (!scrollContainerRef || maxScrollTop <= 0 || thumbTravel <= 0) return;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            moveEvent.preventDefault();
            const scrollDelta = ((moveEvent.clientY - dragStartClientY) / thumbTravel) * maxScrollTop;
            setManualScrollTop(dragStartScrollTop + scrollDelta);
        };
        const handleMouseUp = () => clearScrollThumbDrag();
        clearScrollThumbDrag();
        window.addEventListener("mousemove", handleMouseMove, true);
        window.addEventListener("mouseup", handleMouseUp, true);
        scrollThumbDragCleanup = () => {
            window.removeEventListener("mousemove", handleMouseMove, true);
            window.removeEventListener("mouseup", handleMouseUp, true);
        };
    };

    const handleScrollTrackMouseDown = (event: MouseEvent & { currentTarget: HTMLDivElement }) => {
        event.preventDefault();
        event.stopPropagation();
        void api.focusOverlayWindow();
        if (!scrollContainerRef) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.height <= 0) return;
        const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        setManualScrollTop(ratio * getMaxScrollTop());
    };

    const menuRectId = () => `actions-menu-${props.unit?.id ?? "global"}`;

    const requestBackendRectSync = () => {
        queueMicrotask(() => void syncService.updateBackendRects());
    };

    const cancelMenuRectSync = () => {
        if (menuRectSyncRafId === null) return;
        window.cancelAnimationFrame(menuRectSyncRafId);
        menuRectSyncRafId = null;
    };

    const syncMenuHitRect = () => {
        menuRectSyncRafId = null;
        if (!menuRootRef || !props.showActions || props.unit?.data.minified) return;

        const rect = menuRootRef.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        addOrUpdateRect({
            id: menuRectId(),
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            name: "ACTIONS_MENU",
        });
        requestBackendRectSync();

        const rectLog = `${rect.left.toFixed(1)},${rect.top.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)}`;
        if (rectLog !== lastLoggedMenuRect) {
            lastLoggedMenuRect = rectLog;
            void api.debugLogEvent(
                "add-art-menu-hit-rect",
                `id=${props.unit?.id ?? "global"} rect=${rectLog} dpr=${window.devicePixelRatio || 1}`,
            );
        }
    };

    const scheduleMenuRectSync = () => {
        cancelMenuRectSync();
        menuRectSyncRafId = window.requestAnimationFrame(syncMenuHitRect);
    };

    const beginArtActivation = (
        event: MouseEvent & { currentTarget: HTMLButtonElement },
        artId: string,
    ) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        suppressClickArtId = null;
        if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
        suppressClickTimer = null;
        pendingArtActivation = {
            artId,
            clientX: event.clientX,
            clientY: event.clientY,
        };
        void api.debugLogEvent(
            "add-art-menu-mouse-down",
            `art=${artId} x=${event.clientX.toFixed(1)} y=${event.clientY.toFixed(1)} trusted=${event.isTrusted ? 1 : 0}`,
        );
    };

    const addArtNode = (artId: string, source: "native-mouseup" | "mouseup" | "click") => {
        void api.debugLogEvent("add-art-menu-activate", `art=${artId} source=${source}`);
        props.onAddNode(artId);
    };

    const completePendingArtActivation = (
        clientX: number,
        clientY: number,
        source: "native-mouseup" | "mouseup",
        expectedArtId?: string,
    ) => {
        const pending = pendingArtActivation;
        pendingArtActivation = null;
        if (!pending || (expectedArtId && pending.artId !== expectedArtId)) {
            return;
        }
        const distance = Math.hypot(clientX - pending.clientX, clientY - pending.clientY);
        if (distance > 4) {
            void api.debugLogEvent(
                "add-art-menu-activation-rejected",
                `art=${pending.artId} source=${source} distance=${distance.toFixed(1)}`,
            );
            return;
        }

        suppressClickArtId = pending.artId;
        if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
        suppressClickTimer = window.setTimeout(() => {
            suppressClickArtId = null;
            suppressClickTimer = null;
        }, 500);
        addArtNode(pending.artId, source);
    };

    const completeArtActivation = (
        event: MouseEvent & { currentTarget: HTMLButtonElement },
        artId: string,
    ) => {
        event.stopPropagation();
        if (event.button !== 0) return;
        completePendingArtActivation(event.clientX, event.clientY, "mouseup", artId);
    };

    const handleNativeOverlayMouseUp = (event: Event) => {
        const detail = (event as CustomEvent<OverlaySyntheticMousePayload>).detail;
        if (!detail || !pendingArtActivation) return;
        const clientX = detail.x ?? detail.globalX;
        const clientY = detail.y ?? detail.globalY;
        if (typeof clientX !== "number" || typeof clientY !== "number") {
            const artId = pendingArtActivation.artId;
            pendingArtActivation = null;
            void api.debugLogEvent(
                "add-art-menu-activation-rejected",
                `art=${artId} source=native-mouseup reason=missing-coordinates`,
            );
            return;
        }
        completePendingArtActivation(clientX, clientY, "native-mouseup");
    };

    const handleArtClick = (event: MouseEvent, artId: string) => {
        event.stopPropagation();
        if (suppressClickArtId === artId) {
            suppressClickArtId = null;
            if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
            suppressClickTimer = null;
            return;
        }
        addArtNode(artId, "click");
    };

    // Register the rendered menu bounds, rather than reconstructing them from
    // sticker coordinates. The native input shield must cover exactly the DOM
    // area that elementFromPoint will use for synthetic pointer dispatch.
    createEffect(() => {
        const rectId = menuRectId();
        const visible = props.showActions && !props.unit?.data.minified;
        const layoutSignature = `${props.currentPos.x}:${props.currentPos.y}:${props.unit?.w ?? 0}:${props.unit?.h ?? 0}`;
        void layoutSignature;
        if (!visible) {
            cancelMenuRectSync();
            removeRect(rectId);
            requestBackendRectSync();
            return;
        }

        syncMenuHitRect();
        scheduleMenuRectSync();
        const handleWindowResize = () => scheduleMenuRectSync();
        window.addEventListener("resize", handleWindowResize);
        let observer: ResizeObserver | undefined;
        if (typeof ResizeObserver !== "undefined" && menuRootRef) {
            observer = new ResizeObserver(scheduleMenuRectSync);
            observer.observe(menuRootRef);
        }

        onCleanup(() => {
            observer?.disconnect();
            window.removeEventListener("resize", handleWindowResize);
            cancelMenuRectSync();
            removeRect(rectId);
            requestBackendRectSync();
        });
    });

    createEffect(syncDragFollowerRegistration);

    createEffect(() => {
        const query = searchQuery();
        const shouldReset = query !== lastSearchQuery || filteredArts().length === 0;
        lastSearchQuery = query;
        requestAnimationFrame(() => {
            if (shouldReset) setManualScrollTop(0);
            syncScrollMetrics();
        });
    });

    onMount(() => {
        syncScrollMetrics();
        const rafId = requestAnimationFrame(syncScrollMetrics);
        const handleScrollWindowResize = () => syncScrollMetrics();
        window.addEventListener("resize", handleScrollWindowResize);
        window.addEventListener(OVERLAY_GLOBAL_MOUSE_UP_EVENT, handleNativeOverlayMouseUp);
        onCleanup(() => {
            cancelAnimationFrame(rafId);
            window.removeEventListener("resize", handleScrollWindowResize);
            window.removeEventListener(OVERLAY_GLOBAL_MOUSE_UP_EVENT, handleNativeOverlayMouseUp);
            clearScrollThumbDrag();
        });
    });

    onCleanup(() => {
        const registration = dragFollowerRegistration;
        if (registration) {
            unregisterDragFollowerElement(registration.unitId, registration.element);
            dragFollowerRegistration = null;
        }
        if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
        pendingArtActivation = null;
        suppressClickArtId = null;
        suppressClickTimer = null;
    });

    return (
        <Show when={props.showActions && !props.unit?.data.minified}>
            <Portal mount={document.body}>
                <div
                    ref={(element) => {
                        menuRootRef = element;
                        syncDragFollowerRegistration();
                        scheduleMenuRectSync();
                    }}
                    id={`actions-menu-${props.unit?.id ?? "global"}`}
                    data-hook-drag-follow-unit-id={props.unit?.id}
                    class="absolute pointer-events-auto"
                    onPointerDown={(event) => {
                        event.stopPropagation();
                        void api.focusOverlayWindow();
                    }}
                    onMouseDown={(event) => {
                        event.stopPropagation();
                        void api.focusOverlayWindow();
                    }}
                    onDblClick={(e) => e.stopPropagation()}
                    style={{
                        "z-index": 999999,
                        left: `${props.unit ? props.currentPos.x + props.unit.w / 2 : props.currentPos.x}px`,
                        top: `${props.unit ? props.currentPos.y + props.unit.h / 2 : props.currentPos.y}px`,
                        "margin-left": "-125px",
                        "margin-top": "-150px",
                        width: "250px",
                        height: "300px",
                    }}
                >
                    <div class="hook-terminal-shell hook-terminal-shell--strong flex h-full w-full flex-col overflow-hidden transition duration-200 ease-out animate-in fade-in zoom-in-95">
                        <div class="hook-add-art-header flex flex-shrink-0 items-center gap-1.5 border-b p-2">
                            <div class="relative min-w-0 flex-1">
                                <input
                                    ref={searchInputRef}
                                    data-add-art-search
                                    type="text"
                                    value={searchQuery()}
                                    placeholder="搜索 Art"
                                    aria-label="搜索 Art"
                                    class="hook-terminal-input h-8 w-full px-2.5 pr-8 text-xs"
                                    onInput={(event) => setSearchQuery(event.currentTarget.value)}
                                    onKeyDown={handleSearchKeyDown}
                                    onFocus={() => void api.focusOverlayWindow()}
                                    onPointerDown={(event) => {
                                        event.stopPropagation();
                                        void api.focusOverlayWindow();
                                    }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={(event) => event.stopPropagation()}
                                />
                                <Show when={searchQuery().length > 0}>
                                    <button
                                        data-add-art-clear
                                        type="button"
                                        aria-label="清空搜索"
                                        title="清空搜索"
                                        class="hook-toolbar-button absolute right-1 top-1 flex h-6 w-6 items-center justify-center text-sm"
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={clearSearch}
                                    >
                                        ×
                                    </button>
                                </Show>
                            </div>
                            <button
                                data-add-art-close
                                type="button"
                                aria-label="关闭 Art 菜单"
                                title="关闭"
                                class="hook-terminal-btn flex h-8 w-8 flex-none items-center justify-center text-base"
                                onPointerDown={(event) => event.stopPropagation()}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={closeMenu}
                            >
                                ×
                            </button>
                        </div>

                        <div class="relative flex flex-1 min-h-0 w-full">
                            <div
                                ref={scrollContainerRef}
                                data-add-art-scroll-container
                                class="hook-add-art-scroll-container flex-1 overflow-y-auto overflow-x-hidden bg-transparent p-2 pr-4"
                                onScroll={syncScrollMetrics}
                                onWheel={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void api.focusOverlayWindow();
                                    setManualScrollTop((scrollContainerRef?.scrollTop ?? 0) + event.deltaY);
                                }}
                            >
                                <div class="flex flex-col gap-1.5">
                                    <Show when={filteredArts().length > 0} fallback={
                                        <div class="hook-add-art-empty text-xs font-medium text-center py-8">
                                            {(props.availableArts?.length ?? 0) > 0 ? "未找到 Art" : "No available arts"}
                                        </div>
                                    }>
                                        <For each={filteredArts()}>
                                            {(art) => (
                                                <button
                                                    data-add-art-id={art.id}
                                                    type="button"
                                                    class="hook-terminal-list-item group relative overflow-hidden flex items-center w-full px-2.5 py-2 text-sm transition-all cursor-pointer active:scale-[0.98]"
                                                    onMouseDown={(event) => beginArtActivation(event, art.id)}
                                                    onMouseUp={(event) => completeArtActivation(event, art.id)}
                                                    onClick={(event) => handleArtClick(event, art.id)}
                                                >
                                                    <div class="hook-terminal-icon-tile flex h-7 w-7 items-center justify-center mr-2.5 transition-colors">
                                                        <span class="text-sm">❖</span>
                                                    </div>
                                                    <span class="z-10 min-w-0 flex-1 truncate text-left font-medium">
                                                        {art.label}
                                                    </span>
                                                </button>
                                            )}
                                        </For>
                                    </Show>
                                </div>
                            </div>
                            <div
                                ref={scrollTrackRef}
                                data-add-art-scrollbar-track
                                class="param-scrollbar-track absolute bottom-2 right-1 top-2"
                                style={{
                                    width: "7px",
                                    opacity: hasScrollableOverflow() ? 1 : 0.25,
                                    "pointer-events": hasScrollableOverflow() ? "auto" : "none",
                                }}
                                onMouseDown={handleScrollTrackMouseDown}
                            >
                                <div
                                    data-add-art-scrollbar-thumb
                                    class="param-scrollbar-thumb absolute left-0 right-0"
                                    style={{
                                        height: `${getScrollThumbHeight()}px`,
                                        top: `${getScrollThumbTop()}px`,
                                        opacity: hasScrollableOverflow() ? 1 : 0,
                                    }}
                                    onMouseDown={startScrollThumbDrag}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </Portal>
        </Show>
    );
};
