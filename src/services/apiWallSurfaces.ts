/** Restricted wall operations reuse native device auth and never expose resource bearer leases. */
import { safeInvoke } from './apiTransport';
import type { WallInputBinding } from './apiWallInput';
import { wallImageBlob } from './apiWallImages';
import { parseWallAccepted, parseWallClientResponse } from './wallProtocol';
import { parseWallSurfaceAck, parseWallSurfaceState, sameSurfaceView, type WallSurfaceView } from './wallSurfaceProtocol';
import type { SurfaceEvent } from './surfaceProtocol';
import type { TilePixelPoint } from './wallTypes';

async function request(deviceId: string, kind: string, request: unknown) {
    const response = parseWallClientResponse(await safeInvoke<unknown>('wall_request', { operation: { kind, request } }));
    if (response.deviceId !== deviceId) throw new Error('wall_surface_device_changed');
    return response.body;
}
export interface WallSurfaceAnchor { readonly placementId: string; readonly pixel: TilePixelPoint }
export interface WallSurfaceImage { readonly url: string; readonly pixels: number; close: () => void }

export const wallSurfaceApi = {
    async open(deviceId: string, binding: WallInputBinding, instanceId: string) {
        const state = parseWallSurfaceState(await request(deviceId, 'surface_open', { binding, instanceId }), binding, instanceId, deviceId);
        if (!state.snapshot) throw new Error('wall_surface_snapshot_missing');
        return state;
    },
    async state(deviceId: string, view: WallSurfaceView, snapshotRevision: number) {
        const state = parseWallSurfaceState(await request(deviceId, 'surface_state', { view, snapshotRevision }), view.binding, view.instanceId, deviceId);
        if (!sameSurfaceView(view, state.view)) throw new Error('wall_surface_view_changed');
        return state;
    },
    async close(deviceId: string, view: WallSurfaceView) {
        parseWallAccepted(await request(deviceId, 'surface_close', { view }));
    },
    async image(deviceId: string, view: WallSurfaceView, resourceId: string): Promise<WallSurfaceImage> {
        const image = wallImageBlob(await request(deviceId, 'surface_image', { view, resourceId }), resourceId);
        const bitmap = await createImageBitmap(image.blob);
        try {
            if (bitmap.width !== image.width || bitmap.height !== image.height) throw new Error('wall_image_dimensions_changed');
        } finally { bitmap.close(); }
        const url = URL.createObjectURL(image.blob);
        return { url, pixels: image.width * image.height, close: () => URL.revokeObjectURL(url) };
    },
    async event(deviceId: string, view: WallSurfaceView, anchor: WallSurfaceAnchor, sequence: number, event: SurfaceEvent) {
        if (JSON.stringify(event).length > 96 * 1024) throw new Error('wall_surface_event_too_large');
        return parseWallSurfaceAck(await request(deviceId, 'surface_event', { view, ...anchor, sequence, event }), view.instanceId);
    },
    async confirm(deviceId: string, view: WallSurfaceView, anchor: WallSurfaceAnchor, confirmationId: string, approved: boolean) {
        return parseWallSurfaceAck(await request(deviceId, 'surface_confirmation', { view, ...anchor, confirmationId, approved }), view.instanceId);
    },
    async cancel(deviceId: string, view: WallSurfaceView, requestId: string) {
        return parseWallSurfaceAck(await request(deviceId, 'surface_cancel', { view, requestId }), view.instanceId);
    },
};
