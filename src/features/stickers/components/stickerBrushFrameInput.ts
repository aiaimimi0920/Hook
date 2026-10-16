import { batch, onCleanup } from "solid-js";

interface BrushFrameInputOptions {
    enabled: () => boolean;
    down: (event: PointerEvent) => Promise<void>;
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => Promise<void>;
    cancel: () => Promise<void>;
}

/** Native drags can arrive every 2 ms. Sample them cheaply, then publish once per
 * animation frame, rather than queueing a complete SVG update for every event.
 * Preserve event timestamps and a bounded path, including the newest endpoint. */
export const createStickerBrushFrameInput = (options: BrushFrameInputOptions) => {
    let pending: PointerEvent[] = [];
    let frame: number | undefined;
    const clear = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        pending = [];
    };
    const flush = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        const events = pending;
        pending = [];
        if (!options.enabled()) return;
        batch(() => { for (const event of events) options.move(event); });
    };
    onCleanup(clear);
    return {
        clear,
        down: (event: PointerEvent) => {
            clear();
            return options.down(event).catch((error) => console.error("[Otter] Sticker pointer-down handler failed", error));
        },
        move: (event: PointerEvent) => {
            if (!options.enabled()) {
                clear();
                options.move(event);
                return;
            }
            // Decimate only a stalled frame's backlog, never drop its latest sample.
            if (pending.length >= 32) pending = pending.filter((_, i) => i % 2 === 0);
            pending.push(event);
            frame ??= requestAnimationFrame(flush);
        },
        up: (event: PointerEvent) => {
            // Include pointerup in the same batch: no intermediate redraw or lost tail.
            let result!: Promise<void>;
            batch(() => { flush(); result = options.up(event); });
            return result.catch((error) => console.error("[Otter] Sticker pointer-up handler failed", error));
        },
        cancel: () => {
            clear();
            return options.cancel().catch((error) => console.error("[Otter] Sticker pointer-cancel handler failed", error));
        },
    };
};
