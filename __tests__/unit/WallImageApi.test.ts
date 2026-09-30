import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeInvoke } from '../../src/services/apiTransport';
import { readWallImage } from '../../src/services/apiWallImages';
vi.mock('../../src/services/apiTransport', () => ({ safeInvoke: vi.fn() }));

const id = `sha256:${'a'.repeat(64)}`;
const response = { deviceId: 'device-a', body: { resourceId: id, width: 1, height: 1,
    dataUrl: 'data:image/png;base64,iVBORw==' } };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('native wall image delivery under a restricted connect-src CSP', () => {
    it('creates the bitmap from admitted bytes without invoking fetch or another transport', async () => {
        vi.mocked(safeInvoke).mockResolvedValue(response);
        const fetch = vi.fn(() => { throw new Error('connect-src forbids data URLs'); });
        vi.stubGlobal('fetch', fetch);
        const close = vi.fn();
        const decode = vi.fn(async (blob: Blob) => {
            expect(blob.type).toBe('image/png');
            expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([137, 80, 78, 71]);
            return { width: 1, height: 1, close };
        });
        vi.stubGlobal('createImageBitmap', decode);
        const image = await readWallImage('device-a', 'tile-a', 'lease-a', 3, id);
        expect(fetch).not.toHaveBeenCalled(); expect(decode).toHaveBeenCalledOnce();
        expect(safeInvoke).toHaveBeenCalledWith('wall_request', { operation: {
            kind: 'read_image', endpointId: 'tile-a', leaseId: 'lease-a', revision: 3, resourceId: id,
        } });
        image.close(); expect(close).toHaveBeenCalledOnce();
    });

    it('rejects changed identities before decoding and closes mismatched bitmaps', async () => {
        vi.mocked(safeInvoke).mockResolvedValue(response);
        const close = vi.fn(), decode = vi.fn().mockResolvedValue({ width: 2, height: 1, close });
        vi.stubGlobal('createImageBitmap', decode);
        await expect(readWallImage('device-b', 'tile-a', 'lease-a', 3, id)).rejects.toThrow('wall_image_identity_changed');
        expect(decode).not.toHaveBeenCalled();
        await expect(readWallImage('device-a', 'tile-a', 'lease-a', 3, id)).rejects.toThrow('wall_image_dimensions_changed');
        expect(close).toHaveBeenCalledOnce();
    });
});
