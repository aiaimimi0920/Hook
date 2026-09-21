import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wallSurfaceApi } from '../../src/services/apiWallSurfaces';
import { parseWallSurfaceState } from '../../src/services/wallSurfaceProtocol';
import { binding, surfaceState, surfaceWire } from '../fixtures/wall/surface';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../src/services/apiTransport', () => ({ safeInvoke: invoke }));
beforeEach(() => invoke.mockReset());

describe('wall Surface wire authority', () => {
    it('uses the fixed native operation and checks paired identity and exact presenter binding', async () => {
        invoke.mockResolvedValue({ deviceId: 'device', body: surfaceWire() });
        expect((await wallSurfaceApi.open('device', binding, 'instance')).snapshot?.authoritativeState).toEqual({ count: 7 });
        expect(invoke).toHaveBeenCalledWith('wall_request', { operation: { kind: 'surface_open', request: { binding, instanceId: 'instance' } } });
        invoke.mockResolvedValue({ deviceId: 'other', body: surfaceWire() });
        await expect(wallSurfaceApi.open('device', binding, 'instance')).rejects.toThrow('device_changed');
        const value = surfaceWire(); Object.assign(value.view, { binding: { ...binding, revision: 3 } });
        invoke.mockResolvedValue({ deviceId: 'device', body: value });
        await expect(wallSurfaceApi.open('device', binding, 'instance')).rejects.toThrow('response_invalid');
    });

    it('rejects scripts, leaked leases, duplicate nodes, and future commits before rendering', () => {
        const scripts = surfaceWire(); scripts.snapshot.runtime = 'javascript';
        const leases = surfaceWire(); Object.assign(leases.snapshot, { resourceLeases: [{ leaseId: 'secret-lease' }] });
        const duplicate = surfaceWire(); duplicate.snapshot.scene.children!.push(duplicate.snapshot.scene.children![0]);
        const future = surfaceWire(); Object.assign(future, { preview: { protocolVersion: 'loom.surface.v1', instanceId: 'instance', requestId: 'request',
            generation: 1, previewRevision: 1, portId: 'preview', value: { kind: 'value', value: 'invalid' } } });
        for (const value of [scripts, leases, duplicate, future]) expect(() => parseWallSurfaceState(value, binding, 'instance', 'device')).toThrow();
        const huge = surfaceWire(); huge.snapshot.authoritativeState = 'x'.repeat(2 * 1024 * 1024);
        expect(() => parseWallSurfaceState(huge, binding, 'instance', 'device')).toThrow();
    });

    it('refuses a different attachment on polling and keeps preview separate from formal output', async () => {
        invoke.mockResolvedValue({ deviceId: 'device', body: { protocolVersion: 'loom.wall.v1', ...surfaceState(binding, 'wrong') } });
        await expect(wallSurfaceApi.state('device', surfaceState().view, 1)).rejects.toThrow('view_changed');
        const wire = surfaceWire();
        Object.assign(wire, { preview: { protocolVersion: 'loom.surface.v1', instanceId: 'instance', requestId: 'p', generation: 0,
            previewRevision: 9, portId: 'preview', value: { kind: 'value', value: 'draft' } },
        result: { protocolVersion: 'loom.surface.v1', instanceId: 'instance', requestId: 'r', generation: 0,
            resultRevision: 2, outputs: { output: { kind: 'value', value: 'saved' } } } });
        const parsed = parseWallSurfaceState(wire, binding, 'instance', 'device');
        expect(parsed.preview?.value).toEqual({ kind: 'value', value: 'draft' });
        expect(parsed.result?.outputs.output).toEqual({ kind: 'value', value: 'saved' });
    });

    it('admits only a fixed action failure code and discards server messages', () => {
        const wire = surfaceWire();
        Object.assign(wire, { failure: { requestId: 'failed-request', code: 'wall_surface_action_failed', message: 'private process path' } });
        expect(parseWallSurfaceState(wire, binding, 'instance', 'device').failure)
            .toEqual({ requestId: 'failed-request', code: 'wall_surface_action_failed' });
        Object.assign(wire, { failure: { requestId: 'failed-request', code: 'private arbitrary error' } });
        expect(() => parseWallSurfaceState(wire, binding, 'instance', 'device')).toThrow();
    });
});
