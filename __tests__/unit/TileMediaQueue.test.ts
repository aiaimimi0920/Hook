import { describe, expect, it, vi } from 'vitest';
import { createTileMediaQueue } from '../../src/services/tileMediaQueue';
import type { WallLiveFrame } from '../../src/services/apiWallLive';

function frame(id: number, receivedAtMs: number, epoch = 1n): WallLiveFrame {
    return { width: 1, height: 1, source: {} as CanvasImageSource, close: vi.fn(),
        media: { epoch, frameId: BigInt(id), width: 1, height: 1, receivedAtMs, sentAtMs: receivedAtMs,
            captureAtMs: 1, encodeAtMs: 1, droppedFrames: 0, byteLength: 84, format: 'raw_bgra' } };
}
describe('common-timeline media selection', () => {
    it('selects the same frame after the common deadline despite different arrivals and refresh counts', () => {
        let serverTimeMs = 1000;
        const clock = { estimate: () => ({ serverTimeMs, uncertaintyMs: 5 }) };
        const a = createTileMediaQueue(clock), b = createTileMediaQueue(clock);
        a.push(frame(1, 1000)); a.advance();
        serverTimeMs = 1040; a.advance(); b.push(frame(1, 1000)); b.advance();
        serverTimeMs = 1084; a.advance(); b.advance();
        expect(a.get()).toBeUndefined(); expect(b.get()).toBeUndefined();
        serverTimeMs = 1085; a.advance(); b.advance();
        expect(a.get()?.media.frameId).toBe(1n); expect(b.get()?.media.frameId).toBe(1n);
        for (let i = 0; i < 4; i++) a.advance();
        expect(a.stats().repeatedSelections).toBe(4); expect(b.stats().repeatedSelections).toBe(0);
        a.clear(); b.clear();
    });
    it('bounds pending frames without starving the earliest deadline at high source FPS', () => {
        let serverTimeMs = 1000;
        const queue = createTileMediaQueue({ estimate: () => ({ serverTimeMs, uncertaintyMs: 0 }) });
        const frames = Array.from({ length: 6 }, (_, i) => frame(i + 1, 1000 + i * 10));
        frames.forEach(queue.push);
        expect(queue.stats().pendingFrames).toBe(3);
        expect(queue.stats().skippedFrames).toBe(3);
        serverTimeMs = 1080; queue.advance(); expect(queue.get()).toBe(frames[0]);
        queue.clear(); frames.forEach((item) => expect(item.close).toHaveBeenCalledOnce());
    });
    it('drops late and stale frames, clears an old epoch, and releases all images when clock samples expire', () => {
        let valid = true;
        const queue = createTileMediaQueue({ estimate: () => valid ? { serverTimeMs: 1500, uncertaintyMs: 0 } : undefined });
        const late = frame(1, 1000); queue.push(late); queue.advance();
        expect(late.close).toHaveBeenCalledOnce(); expect(queue.stats().lateFrames).toBe(1);
        const current = frame(2, 1400); queue.push(current); queue.advance(); expect(queue.get()).toBe(current);
        const stale = frame(1, 1400); queue.push(stale); expect(stale.close).toHaveBeenCalledOnce();
        const fresh = frame(1, 1410, 2n); queue.push(fresh); expect(current.close).toHaveBeenCalledOnce();
        queue.advance(); expect(queue.get()).toBe(fresh);
        valid = false; queue.advance(); expect(fresh.close).toHaveBeenCalledOnce(); expect(queue.get()).toBeUndefined();
    });
});
