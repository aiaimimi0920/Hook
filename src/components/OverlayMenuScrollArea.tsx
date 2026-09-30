import { createSignal, createUniqueId, onCleanup, onMount, Show, type JSX } from "solid-js";

/** Menu scrolling must also work with the overlay's untrusted native-event relay. */
export const OverlayMenuScrollArea = (props: { children: JSX.Element; maxHeight?: string; label: string }) => {
    const contentId = `overlay-menu-scroll-${createUniqueId()}`;
    let viewport!: HTMLDivElement;
    let content!: HTMLDivElement;
    let track!: HTMLDivElement;
    let frame = 0;
    let endDrag: (() => void) | undefined;
    const [metrics, setMetrics] = createSignal({ top: 0, height: 0, total: 0 });
    const sync = () => setMetrics({ top: viewport.scrollTop, height: viewport.clientHeight, total: viewport.scrollHeight });
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(sync); };
    const maximum = () => Math.max(0, metrics().total - metrics().height);
    const thumbHeight = () => Math.min(metrics().height, Math.max(18, metrics().height ** 2 / Math.max(1, metrics().total)));
    const travel = () => Math.max(0, metrics().height - thumbHeight());
    const setTop = (value: number) => {
        if (!Number.isFinite(value)) return;
        viewport.scrollTop = Math.max(0, Math.min(value, Math.max(0, viewport.scrollHeight - viewport.clientHeight)));
        sync();
    };
    const wheel = (event: WheelEvent) => {
        event.stopPropagation();
        // Own both event paths, including the custom track, without browser double-scrolling.
        if (event.defaultPrevented) return;
        event.preventDefault();
        const scale = event.deltaMode === 1 ? 28 : event.deltaMode === 2 ? viewport.clientHeight : 1;
        setTop(viewport.scrollTop + event.deltaY * scale);
    };
    const drag = (event: MouseEvent) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        endDrag?.(); sync();
        const startY = event.clientY;
        const startTop = viewport.scrollTop;
        const distance = travel();
        const max = maximum();
        if (distance <= 0 || max <= 0) return;
        const move = (next: MouseEvent) => {
            next.preventDefault(); next.stopPropagation();
            setTop(startTop + (next.clientY - startY) * max / distance);
        };
        const stop = () => {
            window.removeEventListener("mousemove", move, true);
            window.removeEventListener("mouseup", stop, true);
            window.removeEventListener("blur", stop);
            endDrag = undefined;
        };
        window.addEventListener("mousemove", move, true);
        window.addEventListener("mouseup", stop, true);
        window.addEventListener("blur", stop);
        endDrag = stop;
    };
    const jump = (event: MouseEvent) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); sync();
        if (travel() > 0) setTop((event.clientY - track.getBoundingClientRect().top - thumbHeight() / 2) * maximum() / travel());
    };
    const keydown = (event: KeyboardEvent) => {
        const steps: Record<string, number> = { ArrowDown: 28, ArrowUp: -28, PageDown: viewport.clientHeight, PageUp: -viewport.clientHeight };
        const next = event.key === "Home" ? 0 : event.key === "End" ? maximum() : viewport.scrollTop + steps[event.key];
        if (!Number.isFinite(next)) return;
        event.preventDefault(); event.stopPropagation(); setTop(next);
    };
    onMount(() => {
        sync(); schedule();
        const observer = new ResizeObserver(schedule);
        observer.observe(viewport); observer.observe(content);
        onCleanup(() => { observer.disconnect(); cancelAnimationFrame(frame); endDrag?.(); });
    });
    return <div class="relative flex min-h-0 flex-col overflow-hidden" style={{ "max-height": props.maxHeight ?? "220px" }}>
        <div ref={(el) => { viewport = el; }} id={contentId} data-overlay-menu-scroll
            class="param-scroll-container min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain"
            style={{ "padding-right": maximum() > 0 ? "12px" : "0" }} onScroll={sync} onWheel={wheel}>
            <div ref={(el) => { content = el; }}>{props.children}</div>
        </div>
        <Show when={maximum() > 0}>
            <div ref={(el) => { track = el; }} class="param-scrollbar-track absolute right-1 top-0 w-2" style={{ height: `${metrics().height}px` }}
                onMouseDown={jump} onWheel={wheel}>
                <div role="scrollbar" tabIndex={0} aria-label={props.label} aria-controls={contentId} aria-orientation="vertical"
                    aria-valuemin={0} aria-valuemax={Math.round(maximum())} aria-valuenow={Math.round(metrics().top)}
                    class="param-scrollbar-thumb absolute left-0 right-0"
                    style={{ height: `${thumbHeight()}px`, top: `${maximum() ? metrics().top / maximum() * travel() : 0}px` }}
                    onMouseDown={drag} onKeyDown={keydown} />
            </div>
        </Show>
    </div>;
};
