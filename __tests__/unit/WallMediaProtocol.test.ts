import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/wall/wall-media.v1.json';
import { readWallMedia } from '../../src/services/wallMediaProtocol';
import { decodeWallLiveFrame } from '../../src/services/apiWallLive';

const packet = (hex: string) => Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));
describe('wall media protocol golden boundary', () => {
    afterEach(() => vi.unstubAllGlobals());
    it.each(['raw_bgra', 'png'] as const)('reads the shared %s identity, dimensions and daemon timestamps', (format) => {
        const bytes = packet(fixture[format]);
        expect(readWallMedia(bytes.buffer)).toEqual({ format, epoch: 2n, frameId: 7n, width: 2, height: 1,
            captureAtMs: 1000, encodeAtMs: 1002, receivedAtMs: 1700000000020, sentAtMs: 1700000000024,
            droppedFrames: 3, byteLength: bytes.length });
    });
    it('rejects compressed dimension spoofing and unsafe time before invoking a browser decoder', async () => {
        const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
        const bytes = packet(fixture.png), view = new DataView(bytes.buffer);
        view.setUint32(96, 16384);
        await expect(decodeWallLiveFrame(bytes.buffer)).rejects.toThrow('wall_live_dimensions_invalid');
        const raw = packet(fixture.raw_bgra);
        new DataView(raw.buffer).setBigUint64(64, 2n ** 63n);
        await expect(decodeWallLiveFrame(raw.buffer)).rejects.toThrow('wall_live_frame_time_invalid');
        expect(decode).not.toHaveBeenCalled();
    });
    it('checks decoded dimensions and closes a mismatched bitmap', async () => {
        const close = vi.fn(), decode = vi.fn().mockResolvedValue({ width: 200, height: 100, close });
        vi.stubGlobal('createImageBitmap', decode);
        await expect(decodeWallLiveFrame(packet(fixture.png).buffer)).rejects.toThrow('wall_live_dimensions_invalid');
        expect(close).toHaveBeenCalledOnce();
    });
});
