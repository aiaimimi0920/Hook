import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTileLiveCache } from '../../src/services/tileLiveCache';
import { decodeWallLiveFrame } from '../../src/services/apiWallLive';
import type { WallLiveFrame } from '../../src/services/apiWallLive';

const binding = { endpointId: 'tile-a', leaseId: 'lease-a', revision: 1, format: 'raw_bgra' as const };
const image = (): WallLiveFrame => ({ width: 2, height: 2, source: {} as CanvasImageSource, close: vi.fn(),
    media: { width: 2, height: 2, epoch: 1n, frameId: 1n, captureAtMs: 1, encodeAtMs: 1, receivedAtMs: 2,
        sentAtMs: 3, droppedFrames: 0, byteLength: 96, format: 'raw_bgra' } });
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const api = () => ({ open: vi.fn().mockResolvedValue('stream'), close: vi.fn().mockResolvedValue(undefined),
    read: vi.fn<() => Promise<WallLiveFrame | null>>().mockResolvedValue(null) });

describe('wall Live consumer lifecycle', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
    it('deduplicates repeated placements and closes a late decode after lease loss', async () => {
        const transport = api(), cache = createTileLiveCache(transport), bitmap = image();
        let finish!: (value: WallLiveFrame) => void;
        transport.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        cache.prepare('a', ['live-a', 'live-a'], binding); await settle();
        expect(transport.open).toHaveBeenCalledTimes(1);
        cache.clear(); finish(bitmap); await settle();
        expect(bitmap.close).toHaveBeenCalledOnce(); expect(transport.close).toHaveBeenCalledWith('stream');
        expect(cache.get('live-a')).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
    });
    it('closes a late open without replacing the current revision', async () => {
        const transport = api(), cache = createTileLiveCache(transport);
        let finish!: (value: string) => void;
        transport.open.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        cache.prepare('a', ['old'], binding); await settle();
        cache.prepare('b', ['new'], { ...binding, revision: 2 });
        expect(transport.open).toHaveBeenCalledTimes(2);
        finish('old-stream'); await settle(); await vi.advanceTimersByTimeAsync(16);
        expect(transport.close).toHaveBeenCalledWith('old-stream');
        expect(transport.open).toHaveBeenLastCalledWith({ ...binding, revision: 2, sessionId: 'new' });
        cache.clear();
    });
    it('keeps another source advancing while a decode is stalled', async () => {
        const transport = api(), cache = createTileLiveCache(transport), bitmap = image();
        let finish!: (value: WallLiveFrame) => void;
        transport.open.mockImplementation(async ({ sessionId }: { sessionId: string }) => sessionId);
        transport.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
            .mockResolvedValueOnce(bitmap);
        cache.prepare('a', ['slow', 'healthy'], binding); await settle();
        expect(cache.get('healthy')).toBe(bitmap);
        expect(cache.get('slow')).toBeUndefined();
        await vi.advanceTimersByTimeAsync(48);
        expect(transport.read.mock.calls.length).toBeGreaterThan(3);
        cache.clear(); const late = image(); finish(late); await settle();
        expect(late.close).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('counts unfinished opens across rapid layout replacements toward the global bound', async () => {
        const transport = api(), cache = createTileLiveCache(transport);
        const pending: Array<(value: string) => void> = [];
        transport.open.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
        for (let revision = 1; revision <= 20; revision++) {
            cache.prepare(String(revision), ['a', 'b', 'c', 'd'], { ...binding, revision });
        }
        expect(transport.open).toHaveBeenCalledTimes(4);
        cache.clear(); pending.forEach((finish, index) => finish(`old-${index}`)); await settle();
        expect(transport.close).toHaveBeenCalledTimes(4);
        expect(transport.read).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('removes stale pixels immediately on transport loss and retries with bounded backoff', async () => {
        const transport = api(), cache = createTileLiveCache(transport), bitmap = image();
        transport.read.mockResolvedValueOnce(bitmap).mockRejectedValueOnce(new Error('lost'));
        cache.prepare('a', ['live'], binding); await settle(); expect(cache.get('live')).toBe(bitmap);
        await vi.advanceTimersByTimeAsync(16);
        expect(bitmap.close).toHaveBeenCalledOnce(); expect(cache.get('live')).toBeUndefined();
        expect(cache.reason()).toBe('lost');
        await vi.advanceTimersByTimeAsync(1900); expect(transport.open).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(100); expect(transport.open).toHaveBeenCalledTimes(2);
        cache.clear();
    });
    it('rejects excess unique sources without opening native workers', () => {
        const transport = api(), cache = createTileLiveCache(transport);
        expect(cache.prepare('a', ['1', '2', '3', '4', '5'], binding)).toBe(false);
        expect(transport.open).not.toHaveBeenCalled();
    });
    it('rejects malformed or unknown media before asking the browser to decode', async () => {
        const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
        await expect(decodeWallLiveFrame(new ArrayBuffer(0))).rejects.toThrow('wall_live_frame_invalid');
        const bytes = new Uint8Array(84), view = new DataView(bytes.buffer);
        bytes.set([78, 76, 87, 77, 1, 1, 0, 80]); view.setBigUint64(8, 1n); view.setBigUint64(16, 1n);
        view.setBigUint64(64, 2n); view.setBigUint64(72, 3n);
        view.setUint32(40, 1); view.setUint32(44, 1); view.setUint32(52, 4); bytes[56] = 1; bytes[57] = 3;
        await expect(decodeWallLiveFrame(bytes.buffer)).rejects.toThrow('wall_live_frame_invalid');
        expect(decode).not.toHaveBeenCalled();
        bytes[57] = 1;
        decode.mockResolvedValue({ width: 1, height: 1, close: vi.fn() });
        const decoded = await decodeWallLiveFrame(bytes.buffer);
        expect(decoded.width).toBe(1); expect(decode).toHaveBeenCalledOnce(); decoded.close();
    });
});
