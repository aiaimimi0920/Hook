/** Native admission hashes and decodes source bytes; only bounded, normalized PNG reaches the WebView. */
import { safeInvoke } from './apiTransport';
import { parseWallClientResponse } from './wallProtocol';

export interface TileBitmap {
    readonly width: number;
    readonly height: number;
    readonly source: CanvasImageSource;
    close: () => void;
}

export async function readWallImage(deviceId: string, endpointId: string, leaseId: string,
    revision: number, resourceId: string): Promise<TileBitmap> {
    const response = parseWallClientResponse(await safeInvoke<unknown>('wall_request', {
        operation: { kind: 'read_image', endpointId, leaseId, revision, resourceId },
    }));
    if (response.deviceId !== deviceId) throw new Error('wall_image_identity_changed');
    const decoded = wallImageBlob(response.body, resourceId);
    const bitmap = await createImageBitmap(decoded.blob);
    if (bitmap.width !== decoded.width || bitmap.height !== decoded.height) {
        bitmap.close(); throw new Error('wall_image_dimensions_changed');
    }
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
}

export function wallImageBlob(value: unknown, resourceId: string): { blob: Blob; width: number; height: number } {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !('resourceId' in value) || value.resourceId !== resourceId
        || !('width' in value) || typeof value.width !== 'number' || !Number.isInteger(value.width)
        || !('height' in value) || typeof value.height !== 'number' || !Number.isInteger(value.height)
        || value.width < 1 || value.height < 1 || value.width > 16384 || value.height > 16384
        || value.width * value.height > 16_777_216
        || !('dataUrl' in value) || typeof value.dataUrl !== 'string' || value.dataUrl.length > 24 * 1024 * 1024
        || !value.dataUrl.startsWith('data:image/png;base64,')) throw new Error('wall_image_invalid');
    // Decode in memory: fetching a data URL would require widening the tile's connect-src CSP.
    let binary: string;
    try { binary = atob(value.dataUrl.slice('data:image/png;base64,'.length)); }
    catch { throw new Error('wall_image_invalid'); }
    if (!binary.length || binary.length > 16 * 1024 * 1024) throw new Error('wall_image_invalid');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const blob = new Blob([bytes], { type: 'image/png' });
    return { blob, width: value.width, height: value.height };
}
