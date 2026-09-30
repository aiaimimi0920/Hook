/** Shared content-addressed DOM image cache, bounded across all Art views of one output. */
import { wallSurfaceApi, type WallSurfaceImage } from './apiWallSurfaces';
import type { TileSurfaceState } from './tileSurfaceCache';
import type { SurfaceNode } from './surfaceProtocol';
import { tileFailure } from './tilePresenter';

export function surfaceImageIds(state: TileSurfaceState): string[] {
    const ids = new Set<string>(), stack: SurfaceNode[] = [state.snapshot.scene];
    while (stack.length) {
        const node = stack.pop()!;
        const props = node.props && typeof node.props === 'object' ? node.props as Record<string, unknown> : {};
        if (node.type === 'image') {
            if (typeof props.resourceId !== 'string') {
                if (props.src) throw new Error('tile_surface_inline_image_unsupported');
            } else {
                if (!state.snapshot.resources?.some((r) => r.resourceId === props.resourceId && r.kind === 'image')) {
                    throw new Error('wall_surface_resource_invalid');
                }
                ids.add(props.resourceId);
            }
        }
        stack.push(...node.children ?? []);
    }
    return [...ids];
}

export function createTileSurfaceImages(changed: () => void, api = wallSurfaceApi, now = Date.now) {
    const images = new Map<string, WallSurfaceImage>();
    let wanted = new Map<string, TileSurfaceState>();
    let key = '', deviceId = '', generation = 0, running = false, held = false, pixels = 0, error = '';
    let retryAt = 0, timer: ReturnType<typeof setTimeout> | undefined;
    function clear() {
        generation++; held = false; key = ''; wanted.clear(); clearTimeout(timer); timer = undefined;
        images.forEach((image) => image.close()); images.clear(); pixels = 0; error = ''; retryAt = 0;
    }
    function pump() {
        if (held || running) return;
        const next = [...wanted].find(([id]) => !images.has(id));
        if (!next) return;
        if (now() < retryAt) { clearTimeout(timer); timer = setTimeout(pump, retryAt - now()); return; }
        const [id, state] = next, ticket = generation;
        running = true;
        void api.image(deviceId, state.view, id).then((image) => {
            if (ticket !== generation || !wanted.has(id)) { image.close(); return; }
            if (image.pixels + pixels > 16_777_216) { image.close(); throw new Error('tile_surface_image_pixel_limit'); }
            images.set(id, image); pixels += image.pixels; error = ''; retryAt = 0;
        }).catch((failure: unknown) => {
            if (ticket === generation) { error = tileFailure(failure); retryAt = now() + 3000; }
        }).finally(() => { running = false; changed(); pump(); });
    }
    return {
        clear,
        hold() { if (!held) { held = true; generation++; clearTimeout(timer); timer = undefined; } },
        prepare(nextKey: string, nextDeviceId: string, states: readonly TileSurfaceState[]) {
            if (nextKey !== key || held) { clear(); key = nextKey; }
            deviceId = nextDeviceId;
            wanted = new Map(states.flatMap((state) => surfaceImageIds(state).map((id) => [id, state] as const)));
            if (wanted.size > 16) { clear(); throw new Error('tile_surface_image_count_limit'); }
            for (const [id, image] of images) if (!wanted.has(id)) { pixels -= image.pixels; image.close(); images.delete(id); }
            pump();
        },
        ready: () => [...wanted.keys()].every((id) => images.has(id)),
        reason: () => error || 'tile_surface_images_loading',
        get: (id: string) => images.get(id)?.url,
    };
}
