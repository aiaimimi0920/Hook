import { createEffect, createUniqueId, on, onCleanup, onMount } from "solid-js";
import { addOrUpdateRect, removeRect } from "../../../platform/desktop/uiRegistry";
import { syncService } from "../../workspace/services/syncService";

/** Only the actual button is interactive; the preview image remains click-through. */
export function LongCaptureMoveButton(props: {
    label: string; arrow: string; disabled: boolean; move: () => void;
    positionKey: string;
}) {
    let button!: HTMLButtonElement;
    const id = `long-capture-move-${createUniqueId()}`;
    const update = () => {
        const rect = button.getBoundingClientRect();
        addOrUpdateRect({ id, name: "LONG_CAPTURE_MOVE", x: rect.x, y: rect.y,
            width: rect.width, height: rect.height });
        void syncService.updateBackendRects();
    };
    onMount(() => {
        const observer = new ResizeObserver(update);
        observer.observe(button);
        if (button.parentElement) observer.observe(button.parentElement);
        update();
        onCleanup(() => { observer.disconnect(); removeRect(id); void syncService.updateBackendRects(); });
    });
    createEffect(on(() => props.positionKey, () => {
        queueMicrotask(() => { if (button?.isConnected) update(); });
    }));
    return <button ref={(element) => { button = element; }} type="button" aria-label={props.label} title={props.label}
        data-overlay-synthetic-target="direct" disabled={props.disabled}
        class="pointer-events-auto shrink-0 h-7 min-w-7 text-lg text-white bg-neutral-900 hover:bg-neutral-700 disabled:opacity-40"
        on:pointerdown={(event) => event.stopPropagation()}
        on:mousedown={(event) => event.stopPropagation()}
        on:click={(event) => { event.stopPropagation(); if (!props.disabled && button.isConnected) props.move(); }}>
        {props.arrow}
    </button>;
}
