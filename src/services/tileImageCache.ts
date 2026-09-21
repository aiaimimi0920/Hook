/** A single background load keeps control heartbeats independent from image download/decode. */
import type { TileBitmap } from './apiWallImages';
import { tileFailure } from './tilePresenter';

const MAX_IMAGES = 16;
const MAX_PIXELS = 16_777_216;

export function createTileImageCache(now = Date.now) {
    const images = new Map<string, TileBitmap>();
    let pixels = 0;
    let key = '';
    let generation = 0;
    let running = false;
    let failure: { id: string; reason: string; retryAt: number } | undefined;
    function prune(ids: ReadonlySet<string>) {
        for (const [id, image] of images) if (!ids.has(id)) {
            pixels -= image.width * image.height; image.close(); images.delete(id);
        }
    }
    function clear() { generation++; key = ''; failure = undefined; prune(new Set()); }
    function prepare(nextKey: string, resourceIds: readonly string[], read: (id: string) => Promise<TileBitmap>) {
        const wanted = new Set(resourceIds);
        if (wanted.size > MAX_IMAGES) { clear(); return { ready: false, reason: 'tile_image_count_limit' }; }
        if (nextKey !== key) { generation++; key = nextKey; failure = undefined; }
        prune(wanted);
        const missing = [...wanted].find((id) => !images.has(id));
        if (!missing) return { ready: true, reason: '' };
        if (!running && (!failure || failure.id !== missing || now() >= failure.retryAt)) {
            running = true;
            const ticket = generation;
            void Promise.resolve().then(() => read(missing)).then((bitmap) => {
                if (ticket !== generation) { bitmap.close(); return; }
                const cost = bitmap.width * bitmap.height;
                if (!Number.isInteger(bitmap.width) || !Number.isInteger(bitmap.height)
                    || bitmap.width < 1 || bitmap.height < 1 || pixels + cost > MAX_PIXELS) {
                    bitmap.close(); throw new Error('tile_image_cache_pixel_limit');
                }
                images.set(missing, bitmap); pixels += cost; failure = undefined;
            }).catch((error: unknown) => {
                if (ticket === generation) failure = { id: missing, reason: tileFailure(error), retryAt: now() + 10_000 };
            }).finally(() => { running = false; });
        }
        return { ready: false, reason: failure?.reason ?? 'tile_images_loading' };
    }
    return { prepare, clear, get: (id: string) => images.get(id) };
}
