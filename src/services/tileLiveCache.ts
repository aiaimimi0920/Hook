/** Independent latest-frame consumers; unfinished generations still consume decode admission. */
import { wallLiveApi, type WallLiveBinding } from './apiWallLive';
import { tileFailure } from './tilePresenter';
import { createTileMediaQueue } from './tileMediaQueue';
import type { TileClock } from './tileClock';

interface Entry { sessionId: string; streamId?: string; queue: ReturnType<typeof createTileMediaQueue>; error?: string; retryAt: number; busy: boolean }
const MAX_CONSUMERS = 4;
export function createTileLiveCache(api = wallLiveApi, now = Date.now, clock?: TileClock) {
    let key = '', generation = 0, version = 0, running = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let binding: Omit<WallLiveBinding, 'sessionId'> | undefined;
    const entries = new Map<string, Entry>();
    function close(id: string) { void api.close(id).catch(() => {}); }
    function clear() {
        generation++; version++; key = ''; clearTimeout(timer); timer = undefined;
        for (const entry of entries.values()) { entry.queue.clear(); if (entry.streamId) close(entry.streamId); }
        entries.clear(); binding = undefined;
    }
    async function read(entry: Entry, request: Omit<WallLiveBinding, 'sessionId'>) {
        running++; entry.busy = true;
        const ticket = generation;
        try {
            if (!entry.streamId) {
                const id = await api.open({ ...request, sessionId: entry.sessionId });
                if (ticket !== generation) { close(id); return; }
                entry.streamId = id;
            }
            const bitmap = await api.read(entry.streamId);
            if (ticket !== generation) { bitmap?.close(); return; }
            if (bitmap) {
                entry.queue.push(bitmap); entry.error = undefined;
                if (!clock && entry.queue.advance()) version++;
            }
        } catch (error) {
            if (ticket !== generation) return;
            entry.queue.clear();
            if (entry.streamId) close(entry.streamId);
            entry.streamId = undefined; entry.error = tileFailure(error); entry.retryAt = now() + 2000; version++;
        } finally {
            running--; entry.busy = false;
            if (ticket === generation) entry.retryAt = Math.max(entry.retryAt, now() + 16);
            schedule();
        }
    }
    function schedule() {
        clearTimeout(timer); timer = undefined;
        if (!binding || running >= MAX_CONSUMERS) return;
        const waiting = [...entries.values()].filter((entry) => !entry.busy);
        if (!waiting.length) return;
        const delay = Math.max(0, Math.min(...waiting.map((entry) => entry.retryAt)) - now());
        timer = setTimeout(poll, delay);
    }
    function poll() {
        timer = undefined;
        if (!binding) return;
        for (const entry of entries.values()) {
            if (running >= MAX_CONSUMERS) break;
            if (!entry.busy && entry.retryAt <= now()) void read(entry, binding);
        }
        schedule();
    }
    function prepare(nextKey: string, ids: readonly string[], nextBinding: Omit<WallLiveBinding, 'sessionId'>) {
        const wanted = [...new Set(ids)];
        if (wanted.length > MAX_CONSUMERS) { clear(); return false; }
        if (key !== nextKey) {
            clear(); key = nextKey; binding = nextBinding;
            for (const sessionId of wanted) entries.set(sessionId, { sessionId, queue: createTileMediaQueue(clock), retryAt: 0, busy: false });
            poll();
        }
        return true;
    }
    return { prepare, clear, get: (id: string) => entries.get(id)?.queue.get(),
        advance() { for (const entry of entries.values()) if (entry.queue.advance()) version++; },
        stats: () => [...entries.values()].map((entry) => ({ sessionId: entry.sessionId, ...entry.queue.stats() })),
        version: () => version,
        reason: () => [...entries.values()].find((entry) => !entry.queue.get())?.error ?? 'tile_live_loading',
    };
}
