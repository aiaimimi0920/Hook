import { onCleanup, type Component } from "solid-js";
import { setLayoutTick } from "../store/uiStore";
import type { Unit } from "../types/unit";

/** Fits the frame without enlarging it; stale image loads cannot resize another unit. */
export const FitImageFrameButton: Component<{
    unit: Unit | undefined;
    displaySrc: string;
    enabled?: boolean;
    legacy?: boolean;
    onFit: (size: { w: number; h: number }) => void;
}> = (props) => {
    let disposed = false;
    let generation = 0;
    let image: HTMLImageElement | undefined;
    let timer: number | undefined;
    const detach = () => {
        if (image) { image.onload = null; image.onerror = null; image = undefined; }
    };
    onCleanup(() => {
        disposed = true;
        generation++;
        detach();
        if (timer !== undefined) window.clearTimeout(timer);
    });
    const fit = () => {
        const unit = props.unit;
        const src = props.displaySrc;
        if (!unit || !src || props.enabled === false) return;
        const { id, w, h } = unit;
        const request = ++generation;
        detach();
        const pending = new Image();
        image = pending;
        const current = () => !disposed && request === generation && props.enabled !== false
            && props.unit?.id === id && props.displaySrc === src;
        pending.onload = () => {
            if (!current() || props.unit?.w !== w || props.unit?.h !== h) return;
            const iw = pending.naturalWidth || pending.width;
            const ih = pending.naturalHeight || pending.height;
            if (![iw, ih, w, h].every((value) => Number.isFinite(value) && value > 0)) return;
            const ratio = iw / ih;
            props.onFit(ratio > w / h ? { w, h: w / ratio } : { w: h * ratio, h });
            detach();
            if (timer !== undefined) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                timer = undefined;
                if (current()) setLayoutTick((tick) => tick + 1);
            }, 50);
        };
        pending.onerror = () => { if (request === generation) detach(); };
        pending.src = src;
    };
    return <button type="button" aria-label="合拢外框"
        class={props.legacy ? "otter-terminal-btn w-full flex items-center justify-center gap-2 h-7 text-[11px] font-medium" : undefined}
        disabled={!props.unit || !props.displaySrc || props.enabled === false}
        title={props.displaySrc ? "适配图片比例" : "暂无图片内容"}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); fit(); }}>
        <svg class={props.legacy ? "w-3.5 h-3.5" : undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 8h5V3M3 3l5 5m13 0h-5V3m5 0-5 5M3 16h5v5m-5 0 5-5m13 0h-5v5m5 0-5-5" />
        </svg>
        {props.legacy ? "合拢外框" : null}
    </button>;
};
