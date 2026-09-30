/** The wall view grant and preview/formal revisions remain separate on the native boundary. */
import type { WallInputBinding } from './apiWallInput';
import { SURFACE_PROTOCOL_VERSION, type SurfaceActionAck, type SurfaceConfirmationRequest,
    type SurfacePortValue, type SurfacePreviewCommit, type SurfaceResultCommit, type SurfaceSnapshot } from './surfaceProtocol';
import { boundedSurfaceJson, parseWallSurfaceSnapshot, requireSurface, surfaceId, surfaceInteger,
    surfaceList, surfaceObject, surfaceResource } from './wallSurfaceSnapshot';

export interface WallSurfaceView { readonly binding: WallInputBinding; readonly instanceId: string; readonly attachmentId: string }
export interface WallSurfaceState {
    readonly view: WallSurfaceView;
    readonly width: number;
    readonly height: number;
    readonly generation: number;
    readonly sequence: number;
    readonly snapshot: SurfaceSnapshot | null;
    readonly preview: SurfacePreviewCommit | null;
    readonly result: SurfaceResultCommit | null;
    readonly confirmations: readonly SurfaceConfirmationRequest[];
    readonly pending: readonly { ack: SurfaceActionAck; actionId: string; cancelable: boolean }[];
    readonly failure: { readonly requestId: string; readonly code: 'wall_surface_action_failed' } | null;
}

export function sameSurfaceView(a: WallSurfaceView, b: WallSurfaceView): boolean {
    return a.instanceId === b.instanceId && a.attachmentId === b.attachmentId
        && a.binding.endpointId === b.binding.endpointId && a.binding.leaseId === b.binding.leaseId && a.binding.revision === b.binding.revision;
}
export function parseWallSurfaceAck(value: unknown, instanceId: string): SurfaceActionAck {
    const a = surfaceObject(value);
    const status = (['accepted', 'awaiting_confirmation', 'queued', 'running', 'cancel_requested', 'cancelled',
        'succeeded', 'failed', 'interrupted', 'unknown'] as const).find((status) => status === a.status);
    requireSurface(a.protocolVersion === SURFACE_PROTOCOL_VERSION && a.instanceId === instanceId
        && typeof a.accepted === 'boolean' && status !== undefined);
    return { protocolVersion: SURFACE_PROTOCOL_VERSION, instanceId, eventId: surfaceId(a.eventId),
        requestId: surfaceId(a.requestId), accepted: a.accepted, status };
}
function confirmation(value: unknown, view: WallSurfaceView, deviceId: string): SurfaceConfirmationRequest {
    const c = surfaceObject(value);
    const risk = (['low', 'medium', 'high'] as const).find((risk) => risk === c.risk);
    requireSurface(c.protocolVersion === SURFACE_PROTOCOL_VERSION && c.instanceId === view.instanceId
        && c.attachmentId === view.attachmentId && c.deviceId === deviceId && risk !== undefined);
    return { protocolVersion: SURFACE_PROTOCOL_VERSION, instanceId: view.instanceId, attachmentId: view.attachmentId,
        deviceId, risk, confirmationId: surfaceId(c.confirmationId), hookNodeId: surfaceId(c.hookNodeId),
        eventId: surfaceId(c.eventId), requestId: surfaceId(c.requestId), actionId: surfaceId(c.actionId),
        expiresAtMs: surfaceInteger(c.expiresAtMs), payload: c.payload };
}
function port(value: unknown): SurfacePortValue {
    const p = surfaceObject(value);
    if (p.kind === 'value') return { kind: 'value', value: p.value };
    if (p.kind === 'resource') return { kind: 'resource', resource: surfaceResource(p.resource) };
    requireSurface(p.kind === 'stream');
    const s = surfaceObject(p.stream);
    requireSurface(typeof s.itemType === 'string' && s.itemType.length <= 160
        && (s.mime == null || typeof s.mime === 'string' && s.mime.length <= 128));
    return { kind: 'stream', stream: { streamId: surfaceId(s.streamId), itemType: s.itemType,
        sequence: surfaceInteger(s.sequence), mime: typeof s.mime === 'string' ? s.mime : undefined } };
}
function commit(value: unknown, instanceId: string, generation: number) {
    const c = surfaceObject(value);
    requireSurface(c.protocolVersion === SURFACE_PROTOCOL_VERSION && c.instanceId === instanceId);
    return { c, protocolVersion: SURFACE_PROTOCOL_VERSION, instanceId, requestId: surfaceId(c.requestId), generation: surfaceInteger(c.generation, generation) };
}
function preview(value: unknown, id: string, generation: number): SurfacePreviewCommit | null {
    if (value == null) return null;
    const { c, ...base } = commit(value, id, generation);
    return { ...base, previewRevision: surfaceInteger(c.previewRevision), portId: surfaceId(c.portId), value: port(c.value) };
}
function result(value: unknown, id: string, generation: number): SurfaceResultCommit | null {
    if (value == null) return null;
    const { c, ...base } = commit(value, id, generation);
    const outputs = Object.entries(surfaceObject(c.outputs)); requireSurface(outputs.length <= 64);
    return { ...base, resultRevision: surfaceInteger(c.resultRevision),
        outputs: Object.fromEntries(outputs.map(([id, value]) => [surfaceId(id), port(value)])), statePatch: c.statePatch };
}
function failure(value: unknown): WallSurfaceState['failure'] {
    if (value == null) return null;
    const f = surfaceObject(value);
    requireSurface(f.code === 'wall_surface_action_failed');
    return { requestId: surfaceId(f.requestId), code: 'wall_surface_action_failed' };
}

export function parseWallSurfaceState(value: unknown, binding: WallInputBinding, instanceId: string, deviceId: string): WallSurfaceState {
    boundedSurfaceJson(value);
    const s = surfaceObject(value), v = surfaceObject(s.view), b = surfaceObject(v.binding);
    requireSurface(s.protocolVersion === 'loom.wall.v1' && v.instanceId === instanceId
        && b.endpointId === binding.endpointId && b.leaseId === binding.leaseId && b.revision === binding.revision);
    const view = { binding: { ...binding }, instanceId, attachmentId: surfaceId(v.attachmentId) };
    const generation = surfaceInteger(s.generation);
    return { view, generation, sequence: surfaceInteger(s.sequence), width: surfaceInteger(s.width, 4096, 1), height: surfaceInteger(s.height, 4096, 1),
        snapshot: s.snapshot == null ? null : parseWallSurfaceSnapshot(s.snapshot, instanceId, view.attachmentId),
        preview: preview(s.preview, instanceId, generation), result: result(s.result, instanceId, generation), failure: failure(s.failure),
        confirmations: surfaceList(s.confirmations, 64).map((c) => confirmation(c, view, deviceId)),
        pending: surfaceList(s.pending, 1024).map((value) => {
            const p = surfaceObject(value); requireSurface(typeof p.cancelable === 'boolean');
            return { ack: parseWallSurfaceAck(p.ack, instanceId), actionId: surfaceId(p.actionId), cancelable: p.cancelable };
        }) };
}
