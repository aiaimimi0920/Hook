
import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { Unit } from "../types/unit";
import { ArtCapability } from "../services/protocol";
import { api } from "../services/api";
import { addOrUpdateRect, removeRect } from "../services/uiRegistry";

interface UnitAddNodeMenuProps {
  unit?: Unit;
  availableArts?: ArtCapability[];
  onAddNode: (artId: string) => void;
  showActions: boolean;
  currentPos: { x: number; y: number };
}

export const UnitAddNodeMenu: Component<UnitAddNodeMenuProps> = (props) => {
    let scrollContainerRef: HTMLDivElement | undefined;
    let scrollTrackRef: HTMLDivElement | undefined;
    let scrollThumbDragCleanup: (() => void) | undefined;
    let lastSearchQuery = "";
    const [searchQuery, setSearchQuery] = createSignal("");
    const [scrollMetrics, setScrollMetrics] = createSignal({
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        trackHeight: 0,
    });

    const filteredArts = createMemo(() => {
        const query = searchQuery().trim().toLocaleLowerCase();
        const arts = props.availableArts || [];
        if (!query) return arts;
        return arts.filter((art) =>
            [art.label, art.id, art.qualifiedId]
                .filter((value): value is string => typeof value === "string")
                .some((value) => value.toLocaleLowerCase().includes(query)),
        );
    });

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

    // Register Rect for Hit Testing
    createEffect(() => {
        if (props.showActions && !props.unit?.data.minified) {
            const u = props.unit;
            // Center of unit
            const cx = u ? u.x + u.w / 2 : props.currentPos.x;
            const cy = u ? u.y + u.h / 2 : props.currentPos.y;

            addOrUpdateRect({
                  id: `actions-menu-${u?.id ?? "global"}`,
                  x: cx - 125, // Width 250 / 2
                  y: cy - 150, // Height 300 / 2
                  width: 250,
                  height: 300,
                  name: "ACTIONS_MENU"
            });
            onCleanup(() => removeRect(`actions-menu-${u?.id ?? "global"}`));
        } else {
             removeRect(`actions-menu-${props.unit?.id ?? "global"}`);
        }
    });

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
        const handleWindowResize = () => syncScrollMetrics();
        window.addEventListener("resize", handleWindowResize);
        onCleanup(() => {
            cancelAnimationFrame(rafId);
            window.removeEventListener("resize", handleWindowResize);
            clearScrollThumbDrag();
        });
    });

    return (
        <Show when={props.showActions && !props.unit?.data.minified}>
            <Portal mount={document.body}>
                <div
                    id={`actions-menu-${props.unit?.id ?? "global"}`}
                    data-hook-drag-follow-unit-id={props.unit?.id}
                    class="absolute pointer-events-auto text-white"
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
                        <div class="flex-shrink-0 border-b border-white/10 p-2">
                            <input
                                data-add-art-search
                                type="search"
                                value={searchQuery()}
                                placeholder="搜索 Art"
                                aria-label="搜索 Art"
                                class="h-8 w-full rounded border border-white/10 bg-black/25 px-2.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-lime-300/60 focus:bg-black/40"
                                onInput={(event) => setSearchQuery(event.currentTarget.value)}
                                onFocus={() => void api.focusOverlayWindow()}
                                onPointerDown={(event) => {
                                    event.stopPropagation();
                                    void api.focusOverlayWindow();
                                }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => event.stopPropagation()}
                            />
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
                                        <div class="text-white/30 text-xs font-medium text-center py-8">
                                            {(props.availableArts?.length ?? 0) > 0 ? "未找到 Art" : "No available arts"}
                                        </div>
                                    }>
                                        <For each={filteredArts()}>
                                            {(art) => (
                                                <button
                                                    data-add-art-id={art.id}
                                                    class="hook-terminal-list-item group relative overflow-hidden flex items-center w-full px-2.5 py-2 text-sm transition-all cursor-pointer active:scale-[0.98] text-white"
                                                    style={{ color: "white" }}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        props.onAddNode(art.id);
                                                    }}
                                                    onMouseDown={(event) => event.stopPropagation()}
                                                >
                                                    <div class="hook-terminal-icon-tile flex h-7 w-7 items-center justify-center mr-2.5 transition-colors">
                                                        <span class="text-sm">❖</span>
                                                    </div>
                                                    <span class="z-10 min-w-0 flex-1 truncate text-left font-medium text-gray-100 group-hover:text-white">
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
