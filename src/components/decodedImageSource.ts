import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

/** Publish only decoded pixels; stale loads never replace a newer protected frame. */
export function createDecodedImageSource(source: Accessor<string | null | undefined>): Accessor<string | undefined> {
    const [ready, setReady] = createSignal<string>();
    // Presentation-only updates may invalidate the accessor without changing pixels.
    const currentSource = createMemo(source);
    createEffect(() => {
        const src = currentSource();
        setReady(undefined);
        if (!src) return;
        const image = new Image();
        let active = true;
        const release = () => {
            active = false;
            image.removeAttribute("src");
        };
        // A failed or stalled decode keeps the caller's protected fallback visible.
        const timeout = setTimeout(release, 10_000);
        onCleanup(() => { clearTimeout(timeout); release(); });
        image.src = src;
        void image.decode().then(() => {
            clearTimeout(timeout);
            if (active && image.naturalWidth > 0 && image.naturalHeight > 0) setReady(src);
        }).catch(() => { clearTimeout(timeout); });
    });
    return () => ready() === currentSource() ? ready() : undefined;
}
