import { batch, createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";
import { createDecodedImageSource } from "../../../shared/images/decodedImageSource";
import { acquireStickerBlurTexture } from "../services/stickerBlurTexture";

interface BlurInput { source?: string; width: number; height: number; radius: number }
interface BlurFrame extends Omit<BlurInput, "source"> { src: string; raster: boolean }
type Lease = ReturnType<typeof acquireStickerBlurTexture>;

/** Keep decoded blur pixels and their lease alive until a replacement can be painted. */
export const createStickerBlurPresentation = (input: Accessor<BlurInput>) => {
    // Window-only updates invalidate upstream getters without changing these pixels.
    const current = createMemo(input, undefined, { equals: (a, b) =>
        a.source === b.source && a.width === b.width && a.height === b.height && a.radius === b.radius });
    const [frame, setFrame] = createSignal<BlurFrame>();
    let retained: Lease | undefined;
    const publish = (next: BlurFrame | undefined, lease?: Lease) => {
        const previous = retained;
        retained = lease;
        setFrame(next);
        if (previous !== lease) previous?.release();
    };
    onCleanup(() => { retained?.release(); retained = undefined; });
    createEffect(() => {
        const { source, width, height, radius } = current();
        const previous = untrack(frame);
        // A stronger blur or a different frame must not reuse weaker/misaligned pixels.
        if (!source || (previous && (previous.width !== width || previous.height !== height || previous.radius !== radius))) {
            publish(undefined);
        }
        if (!source) return;
        const acquired = acquireStickerBlurTexture(source, width, height, radius);
        let released = false;
        const lease: Lease = { ...acquired, release: () => {
            if (!released) { released = true; acquired.release(); }
        } };
        let active = true;
        const [candidate, setCandidate] = createSignal({ src: lease.url ?? source, raster: !!lease.url });
        const [settled, setSettled] = createSignal(!!lease.url);
        const decoded = createDecodedImageSource(() => candidate().src);
        createEffect(() => {
            const next = candidate();
            const ready = decoded();
            const finished = settled();
            if (!ready || ready !== next.src) return;
            // Do not bounce from a retained raster through an interim SVG filter.
            // First loads and unavailable raster caches may still use decoded SVG blur.
            if (!next.raster && untrack(frame) && !finished) return;
            publish({ src: ready, raster: next.raster, width, height, radius }, next.raster ? lease : undefined);
        });
        void lease.ready.then((url) => {
            if (!active) return;
            batch(() => {
                if (url) setCandidate({ src: url, raster: true });
                setSettled(true);
            });
        });
        onCleanup(() => {
            active = false;
            // A displayed blob outlives its request; pending/stale leases do not.
            if (retained !== lease) lease.release();
        });
    });
    return frame;
};
