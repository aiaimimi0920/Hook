import { describe, expect, it, vi } from 'vitest';
import { createTileImageCache } from '../../src/services/tileImageCache';
import type { TileBitmap } from '../../src/services/apiWallImages';

const bitmap = (width = 2, height = 2): TileBitmap => ({ width, height,
    source: {} as CanvasImageSource, close: vi.fn() });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('tile image cache ownership and budgets', () => {
    it('shares an image across placements and revisions, and releases it when no longer referenced', async () => {
        const cache = createTileImageCache(), image = bitmap(), read = vi.fn().mockResolvedValue(image);
        expect(cache.prepare('rev1', ['a', 'a'], read).ready).toBe(false);
        await settle();
        expect(cache.prepare('rev2', ['a'], read).ready).toBe(true);
        expect(read).toHaveBeenCalledTimes(1);
        expect(cache.get('a')).toBe(image);
        expect(cache.prepare('rev3', [], read).ready).toBe(true);
        expect(image.close).toHaveBeenCalledTimes(1);
        cache.clear(); expect(image.close).toHaveBeenCalledTimes(1);
    });

    it('closes late downloads after lease loss and does not start parallel loads', async () => {
        const cache = createTileImageCache(), image = bitmap();
        let finish!: (image: TileBitmap) => void;
        const read = vi.fn(() => new Promise<TileBitmap>((resolve) => { finish = resolve; }));
        cache.prepare('old', ['a', 'b'], read); await settle();
        cache.clear(); cache.prepare('new', ['b'], read);
        expect(read).toHaveBeenCalledTimes(1);
        finish(image); await settle();
        expect(image.close).toHaveBeenCalledOnce(); expect(cache.get('a')).toBeUndefined();
        cache.prepare('new', ['b'], read); await settle();
        expect(read).toHaveBeenCalledTimes(2);
        cache.clear(); finish(bitmap()); await settle();
    });

    it('bounds aggregate pixels and retries a failure with backoff', async () => {
        let now = 0;
        const cache = createTileImageCache(() => now), first = bitmap(4096, 4096), rejected = bitmap();
        const read = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(rejected);
        cache.prepare('rev1', ['a', 'b'], read); await settle();
        cache.prepare('rev1', ['a', 'b'], read); await settle();
        expect(rejected.close).toHaveBeenCalledOnce();
        expect(cache.prepare('rev1', ['a', 'b'], read)).toEqual({ ready: false, reason: 'tile_image_cache_pixel_limit' });
        expect(read).toHaveBeenCalledTimes(2);
        now = 10001; cache.prepare('rev1', ['a', 'b'], read); await settle();
        expect(read).toHaveBeenCalledTimes(3);
        cache.clear(); expect(first.close).toHaveBeenCalledOnce();
    });

    it('contains synchronous reader failures and rejects excessive source counts without fetching', async () => {
        const cache = createTileImageCache(), read = vi.fn(() => { throw new Error('reader_failed'); });
        cache.prepare('rev1', ['a'], read); await settle();
        expect(cache.prepare('rev1', ['a'], read).reason).toBe('reader_failed');
        expect(cache.prepare('rev2', Array.from({ length: 17 }, (_, i) => String(i)), read).reason).toBe('tile_image_count_limit');
        expect(read).toHaveBeenCalledOnce();
    });
});
