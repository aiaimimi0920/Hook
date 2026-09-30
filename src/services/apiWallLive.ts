/** Binary IPC preserves NLWM framing; credentials and media sockets stay native. */
import { safeInvoke } from './apiTransport';
import { encodeBgraAsBmp } from './liveRelay';
import type { TileBitmap } from './apiWallImages';
import { readWallMedia, type WallMediaFormat, type WallMediaInfo } from './wallMediaProtocol';

export interface WallLiveBinding { endpointId: string; leaseId: string; revision: number; sessionId: string; format: WallMediaFormat }
export interface WallLiveFrame extends TileBitmap { media: WallMediaInfo }
export const wallLiveApi = {
    open: (request: WallLiveBinding) => safeInvoke<string>('wall_live_open', { request }),
    close: (streamId: string) => safeInvoke<void>('wall_live_close', { streamId }),
    async read(streamId: string): Promise<WallLiveFrame | null> {
        const value = await safeInvoke<unknown>('wall_live_read', { streamId });
        if (!(value instanceof ArrayBuffer)) throw new Error('wall_live_ipc_invalid');
        if (!value.byteLength) return null;
        return decodeWallLiveFrame(value);
    },
};

export async function decodeWallLiveFrame(buffer: ArrayBuffer): Promise<WallLiveFrame> {
    const media = readWallMedia(buffer), { width, height, format } = media;
    const payload = new Uint8Array(buffer, 80);
    const bytes = format === 'png' ? payload : encodeBgraAsBmp(payload, width, height);
    const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: format === 'png' ? 'image/png' : 'image/bmp' }));
    if (bitmap.width !== width || bitmap.height !== height) { bitmap.close(); throw new Error('wall_live_dimensions_invalid'); }
    return { width, height, source: bitmap, close: () => bitmap.close(), media };
}
