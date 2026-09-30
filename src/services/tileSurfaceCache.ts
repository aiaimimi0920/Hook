/** One serial poll owner, at most four ephemeral views; stale replies are closed, never presented. */
import { wallSurfaceApi } from './apiWallSurfaces';
import type { WallInputBinding } from './apiWallInput';
import type { SurfaceSnapshot } from './surfaceProtocol';
import { sameSurfaceView, type WallSurfaceState, type WallSurfaceView } from './wallSurfaceProtocol';
import { tileFailure } from './tilePresenter';

export type TileSurfaceState = WallSurfaceState & { readonly snapshot: SurfaceSnapshot };
interface Entry { id: string; deviceId: string; binding: WallInputBinding; state?: TileSurfaceState; view?: WallSurfaceView; reason: string; next: number; attempt: number }

export function createTileSurfaceCache(changed: () => void, api = wallSurfaceApi, now = Date.now) {
    const entries = new Map<string, Entry>();
    const waiters = new Map<Entry, { after: number; resolve: (state: TileSurfaceState | undefined) => void }[]>();
    let key = '', generation = 0, running = false, held = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function close(entry: Entry) {
        waiters.get(entry)?.forEach(({ resolve }) => resolve(undefined)); waiters.delete(entry);
        if (entry.view) void api.close(entry.deviceId, entry.view).catch(() => { /* Presenter TTL also reaps abandoned views. */ });
    }
    function clear() {
        generation++; held = false; key = ''; clearTimeout(timer); timer = undefined;
        entries.forEach(close); entries.clear(); changed();
    }
    async function read(entry: Entry, ticket: number) {
        const attempt = ++entry.attempt;
        entry.next = now() + 350;
        let next: WallSurfaceState | undefined;
        try {
            next = entry.view && entry.state
                ? await api.state(entry.deviceId, entry.view, entry.state.snapshot.revision)
                : await api.open(entry.deviceId, entry.binding, entry.id);
            if (ticket !== generation || entries.get(entry.id) !== entry) {
                // A paused existing view still owns accepted work. Discard its late snapshot, not its attachment.
                if (!held || entries.get(entry.id) !== entry || !entry.view || !sameSurfaceView(entry.view, next.view)) {
                    await api.close(entry.deviceId, next.view).catch(() => {});
                }
                return;
            }
            const previous = entry.state;
            const snapshot = next.snapshot ?? previous?.snapshot;
            if (!snapshot || previous && (next.generation < previous.generation
                || snapshot.revision < previous.snapshot.revision
                || (next.preview?.previewRevision ?? 0) < (previous.preview?.previewRevision ?? 0)
                || (next.result?.resultRevision ?? 0) < (previous.result?.resultRevision ?? 0)
                || !sameSurfaceView(previous.view, next.view))) throw new Error('wall_surface_stale_state');
            entry.view = next.view; entry.state = { ...next, snapshot }; entry.reason = '';
        } catch (error) {
            if (ticket !== generation || entries.get(entry.id) !== entry) return;
            if (next && !entry.view) entry.view = next.view;
            close(entry); entry.view = undefined; entry.state = undefined;
            entry.reason = tileFailure(error); entry.next = now() + 2000;
        }
        const waiting = waiters.get(entry) ?? [];
        waiting.filter((waiter) => waiter.after <= attempt).forEach(({ resolve }) => resolve(entry.state));
        const remaining = waiting.filter((waiter) => waiter.after > attempt);
        if (remaining.length) waiters.set(entry, remaining); else waiters.delete(entry);
        if (ticket === generation) changed();
    }
    function pump() {
        if (held || running || !entries.size) return;
        clearTimeout(timer); timer = undefined;
        const entry = [...entries.values()].sort((a, b) => a.next - b.next)[0];
        if (entry.next > now()) { timer = setTimeout(pump, Math.max(30, entry.next - now())); return; }
        running = true;
        void read(entry, generation).finally(() => { running = false; if (!held && entries.size) timer = setTimeout(pump, 30); });
    }
    return {
        clear,
        hold() {
            if (held) return;
            held = true; generation++; clearTimeout(timer); timer = undefined;
            waiters.forEach((waiting) => waiting.forEach(({ resolve }) => resolve(undefined))); waiters.clear();
        },
        prepare(nextKey: string, deviceId: string, binding: WallInputBinding, ids: readonly string[]) {
            const wanted = new Set(ids);
            if (wanted.size > 4) throw new Error('tile_surface_source_limit');
            if (nextKey !== key || held) { clear(); key = nextKey; }
            for (const [id, entry] of entries) if (!wanted.has(id)) { close(entry); entries.delete(id); }
            for (const id of wanted) if (!entries.has(id)) entries.set(id, { id, deviceId, binding, reason: 'tile_surfaces_loading', next: 0, attempt: 0 });
            pump();
        },
        refresh(id: string) { const entry = entries.get(id); if (entry) { entry.next = 0; pump(); } },
        sync(id: string): Promise<TileSurfaceState | undefined> {
            const entry = entries.get(id);
            if (held || !entry || (waiters.get(entry)?.length ?? 0) >= 32) return Promise.resolve(undefined);
            const result = new Promise<TileSurfaceState | undefined>((resolve) => {
                const waiting = waiters.get(entry) ?? [];
                waiting.push({ after: entry.attempt + 1, resolve }); waiters.set(entry, waiting);
            });
            entry.next = 0; pump(); return result;
        },
        reset(id: string) {
            const entry = entries.get(id);
            if (entry) {
                close(entry);
                entries.set(id, { ...entry, state: undefined, view: undefined, next: now() + 500 });
                changed();
            }
        },
        get: (id: string) => entries.get(id)?.state,
        states: () => [...entries.values()].flatMap((entry) => entry.state ? [entry.state] : []),
        ready: () => [...entries.values()].every((entry) => Boolean(entry.state)),
        reason: () => [...entries.values()].find((entry) => entry.reason)?.reason ?? '',
    };
}
