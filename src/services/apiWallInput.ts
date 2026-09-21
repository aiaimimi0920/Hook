/** Endpoint-scoped authority; device credentials never cross the native boundary. */
import { safeInvoke } from './apiTransport';
import { parseWallAccepted, parseWallClientResponse, parseWallControlGrant } from './wallProtocol';
import type { TilePixelPoint } from './wallTypes';

export interface WallInputBinding { readonly endpointId: string; readonly leaseId: string; readonly revision: number }
export interface WallControlReference { readonly binding: WallInputBinding; readonly controlId: string }
export type WallInputEvent =
    | { kind: 'move'; pixel: TilePixelPoint; pointerId: number }
    | { kind: 'button'; pixel: TilePixelPoint; pointerId: number; button: 'left' | 'middle' | 'right'; state: 'pressed' | 'released'; clickCount: number }
    | { kind: 'wheel'; pixel: TilePixelPoint; deltaX: number; deltaY: number }
    | { kind: 'key'; virtualKey: number; state: 'pressed' | 'released' };

async function request(deviceId: string, kind: string, body: unknown) {
    const response = parseWallClientResponse(await safeInvoke<unknown>('wall_request', { operation: { kind, request: body } }));
    if (response.deviceId !== deviceId) throw new Error('wall_input_device_changed');
    return response.body;
}

export const wallInputApi = {
    async acquire(deviceId: string, binding: WallInputBinding, pixel: TilePixelPoint, pointerId: number) {
        const grant = parseWallControlGrant(await request(deviceId, 'control_acquire', { binding, pixel, pointerId }));
        if (grant.endpointId !== binding.endpointId || grant.revision !== binding.revision) throw new Error('wall_input_grant_mismatch');
        return grant;
    },
    async send(deviceId: string, control: WallControlReference, sequence: number, event: WallInputEvent) {
        parseWallAccepted(await request(deviceId, 'input', { control, sequence, event }));
    },
    async renew(deviceId: string, control: WallControlReference) {
        parseWallAccepted(await request(deviceId, 'control_renew', control));
    },
    async release(deviceId: string, control: WallControlReference) {
        parseWallAccepted(await request(deviceId, 'control_release', control));
    },
};
