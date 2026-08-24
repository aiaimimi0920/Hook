import {
    Component,
    For,
    JSX,
    Show,
    createEffect,
    createMemo,
    createSignal,
    on,
    onCleanup,
    onMount,
} from "solid-js";
import { buildArtParamGroups, shouldGroupArtParams } from "../services/artParamGrouping";
import { api } from "../services/api";
import { buildArtCandidateSetFingerprint } from "../services/artCandidateSetFingerprint";
import { ArtParam } from "../services/protocol";
import { Unit } from "../types/unit";

export const UNIT_PARAMS_SCROLL_REGISTRY_LIMIT = 512;
const globalScrollRegistry = new Map<string, number>();

export const rememberUnitParamsScrollTop = (unitId: string, scrollTop: number) => {
    globalScrollRegistry.delete(unitId);
    globalScrollRegistry.set(unitId, scrollTop);
    while (globalScrollRegistry.size > UNIT_PARAMS_SCROLL_REGISTRY_LIMIT) {
        const oldestUnitId = globalScrollRegistry.keys().next().value;
        if (typeof oldestUnitId !== "string") break;
        globalScrollRegistry.delete(oldestUnitId);
    }
};

export const readUnitParamsScrollTop = (unitId: string) => globalScrollRegistry.get(unitId);
export const getUnitParamsScrollRegistrySize = () => globalScrollRegistry.size;

interface UnitParamsScrollRegionProps {
    unit: Unit;
    params: ArtParam[];
    renderParamControl: (param: ArtParam) => JSX.Element;
}

/** Owns parameter-list scrolling, grouped rendering, and custom thumb geometry. */
export const UnitParamsScrollRegion: Component<UnitParamsScrollRegionProps> = (props) => {
    let scrollContainerRef: HTMLDivElement | undefined;
    let scrollTrackRef: HTMLDivElement | undefined;
    let scrollThumbDragCleanup: (() => void) | undefined;
    let metricsRafId: number | undefined;
    let restoreRafId: number | undefined;
    let disposed = false;
    const [scrollMetrics, setScrollMetrics] = createSignal({
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0,
        trackHeight: 0,
    });
    const paramGroups = createMemo(() => buildArtParamGroups(props.params));
    const candidateSetSignature = createMemo(() =>
        buildArtCandidateSetFingerprint(props.unit.data.resultCandidates || []),
    );

    const syncScrollMetrics = () => {
        if (disposed || !scrollContainerRef) return;
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

    const scheduleMetricsSync = () => {
        if (disposed || metricsRafId !== undefined) return;
        metricsRafId = requestAnimationFrame(() => {
            metricsRafId = undefined;
            syncScrollMetrics();
        });
    };

    const getMaxScrollTop = () =>
        Math.max(0, scrollMetrics().scrollHeight - scrollMetrics().clientHeight);

    const setManualScrollTop = (nextScrollTop: number) => {
        if (!scrollContainerRef) return;
        const maxScrollTop = Math.max(
            0,
            scrollContainerRef.scrollHeight - scrollContainerRef.clientHeight,
        );
        const clampedScrollTop = Math.max(0, Math.min(nextScrollTop, maxScrollTop));
        scrollContainerRef.scrollTop = clampedScrollTop;
        rememberUnitParamsScrollTop(props.unit.id, clampedScrollTop);
        syncScrollMetrics();
    };

    const applyManualScrollDelta = (deltaY: number) => {
        const currentScrollTop = scrollContainerRef?.scrollTop ?? scrollMetrics().scrollTop;
        setManualScrollTop(currentScrollTop + deltaY);
    };

    const hasScrollableOverflow = () =>
        scrollMetrics().scrollHeight > scrollMetrics().clientHeight + 1;
    const getScrollTrackHeight = () => {
        const metrics = scrollMetrics();
        return metrics.trackHeight > 0 ? metrics.trackHeight : metrics.clientHeight;
    };
    const getScrollThumbHeight = () => {
        const metrics = scrollMetrics();
        const trackHeight = getScrollTrackHeight();
        if (trackHeight <= 0 || metrics.clientHeight <= 0 || metrics.scrollHeight <= 0) return 0;
        if (!hasScrollableOverflow()) return trackHeight;
        return Math.min(
            trackHeight,
            Math.max(18, (metrics.clientHeight / metrics.scrollHeight) * trackHeight),
        );
    };
    const getScrollThumbTravel = () =>
        Math.max(0, getScrollTrackHeight() - getScrollThumbHeight());
    const getScrollThumbTop = () => {
        const maxScrollTop = getMaxScrollTop();
        if (maxScrollTop <= 0) return 0;
        return (scrollMetrics().scrollTop / maxScrollTop) * getScrollThumbTravel();
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
            const deltaY = moveEvent.clientY - dragStartClientY;
            setManualScrollTop(dragStartScrollTop + (deltaY / thumbTravel) * maxScrollTop);
        };
        const handleMouseUp = () => clearScrollThumbDrag();

        clearScrollThumbDrag();
        window.addEventListener("mousemove", handleMouseMove, true);
        window.addEventListener("mouseup", handleMouseUp, true);
        // eslint-disable-next-line solid/reactivity -- detach-only closure; reactive reads happen in the live drag handlers.
        scrollThumbDragCleanup = () => {
            window.removeEventListener("mousemove", handleMouseMove, true);
            window.removeEventListener("mouseup", handleMouseUp, true);
        };
    };

    const handleScrollTrackMouseDown = (
        event: MouseEvent & { currentTarget: HTMLDivElement },
    ) => {
        event.preventDefault();
        event.stopPropagation();
        void api.focusOverlayWindow();
        if (!scrollContainerRef) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.height <= 0) return;
        const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
        setManualScrollTop(ratio * getMaxScrollTop());
    };

    createEffect(
        on(
            () => [props.params.length, paramGroups().length, candidateSetSignature()],
            scheduleMetricsSync,
        ),
    );

    onMount(() => {
        syncScrollMetrics();
        scheduleMetricsSync();
        let scrollContainerObserver: ResizeObserver | null = null;
        let scrollContentObserver: ResizeObserver | null = null;
        let scrollTrackObserver: ResizeObserver | null = null;

        if (typeof ResizeObserver !== "undefined" && scrollContainerRef) {
            scrollContainerObserver = new ResizeObserver(() => syncScrollMetrics());
            scrollContainerObserver.observe(scrollContainerRef);
            const scrollContent = scrollContainerRef.firstElementChild;
            if (scrollContent instanceof HTMLElement) {
                scrollContentObserver = new ResizeObserver(() => syncScrollMetrics());
                scrollContentObserver.observe(scrollContent);
            }
            if (scrollTrackRef) {
                scrollTrackObserver = new ResizeObserver(() => syncScrollMetrics());
                scrollTrackObserver.observe(scrollTrackRef);
            }
        }

        const handleWindowResize = () => syncScrollMetrics();
        window.addEventListener("resize", handleWindowResize);
        onCleanup(() => {
            disposed = true;
            if (metricsRafId !== undefined) cancelAnimationFrame(metricsRafId);
            if (restoreRafId !== undefined) cancelAnimationFrame(restoreRafId);
            metricsRafId = undefined;
            restoreRafId = undefined;
            window.removeEventListener("resize", handleWindowResize);
            scrollContainerObserver?.disconnect();
            scrollContentObserver?.disconnect();
            scrollTrackObserver?.disconnect();
            clearScrollThumbDrag();
        });
    });

    return (
        <div
            class="relative flex w-full flex-1 min-h-0"
            style={{ "max-height": "min(360px, calc(100vh - 300px))" }}
        >
            <div
                ref={(element) => {
                    scrollContainerRef = element;
                    const unitId = props.unit.id;
                    const savedScrollTop = readUnitParamsScrollTop(unitId);
                    if (restoreRafId !== undefined) cancelAnimationFrame(restoreRafId);
                    restoreRafId = requestAnimationFrame(() => {
                        restoreRafId = undefined;
                        if (disposed || props.unit.id !== unitId) return;
                        if (typeof savedScrollTop === "number") {
                            setManualScrollTop(savedScrollTop);
                        } else {
                            syncScrollMetrics();
                        }
                    });
                }}
                onScroll={(event) => {
                    rememberUnitParamsScrollTop(props.unit.id, event.currentTarget.scrollTop);
                    syncScrollMetrics();
                }}
                onWheel={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void api.focusOverlayWindow();
                    applyManualScrollDelta(event.deltaY);
                }}
                class="param-scroll-container bg-transparent w-full"
                style={{
                    flex: "1",
                    "min-height": "0",
                    "overflow-y": "auto",
                    "overflow-x": "hidden",
                    "max-height": "min(360px, calc(100vh - 300px))",
                    "padding-right": "12px",
                }}
            >
                <div class="flex flex-col gap-3 p-4 pt-0">
                    <Show
                        when={shouldGroupArtParams(props.params)}
                        fallback={<For each={props.params}>{(param) => props.renderParamControl(param)}</For>}
                    >
                        <For each={paramGroups()}>
                            {(group) => (
                                <div class="param-group flex flex-col gap-3" data-param-group={group.id}>
                                    <div
                                        class="hook-param-group-header flex items-center justify-between gap-2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
                                        data-param-group-header={group.id}
                                    >
                                        <span class="truncate">{group.label}</span>
                                        <span class="hook-param-group-count">{group.params.length}</span>
                                    </div>
                                    <For each={group.params}>{(param) => props.renderParamControl(param)}</For>
                                </div>
                            )}
                        </For>
                    </Show>
                </div>
            </div>
            <div
                ref={scrollTrackRef}
                data-param-scrollbar-track
                class="param-scrollbar-track absolute bottom-3 right-1 top-3"
                style={{ width: "8px", opacity: hasScrollableOverflow() ? 1 : 0.35 }}
                onMouseDown={handleScrollTrackMouseDown}
            >
                <div
                    data-param-scrollbar-thumb
                    class="param-scrollbar-thumb absolute left-0 right-0"
                    style={{
                        height: `${getScrollThumbHeight()}px`,
                        top: `${getScrollThumbTop()}px`,
                        opacity: hasScrollableOverflow() ? 1 : 0.45,
                        "pointer-events": hasScrollableOverflow() ? "auto" : "none",
                    }}
                    onMouseDown={startScrollThumbDrag}
                />
            </div>
        </div>
    );
};
