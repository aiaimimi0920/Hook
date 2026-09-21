import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureText from '../fixtures/wall/wall-geometry.v1.json?raw';
import { wallApi } from '../../src/services/apiWall';
import { safeInvoke } from '../../src/services/apiTransport';
import { parseWallState } from '../../src/services/wallProtocol';
import { WALL_PROTOCOL_VERSION, type TileEndpoint, type WallLayout } from '../../src/services/wallTypes';

vi.mock('../../src/services/apiTransport', () => ({ safeInvoke: vi.fn() }));

function snapshot() {
    const data = JSON.parse(fixtureText) as { layout: WallLayout; endpoints: TileEndpoint[] };
    return {
        protocolVersion: WALL_PROTOCOL_VERSION, revision: 7, layouts: [data.layout],
        endpoints: [{ endpoint: data.endpoints[0], online: true, appliedRevision: null as number | null }],
    };
}

describe('native wall control boundary', () => {
    beforeEach(() => { vi.mocked(safeInvoke).mockReset(); });

    it('accepts device-scoped state containing other tiles in the same authorized wall', async () => {
        const state = snapshot();
        vi.mocked(safeInvoke).mockResolvedValue({ deviceId: 'computer-a', body: state });
        const result = await wallApi.readState();
        expect(result.state.layouts[0].tiles).toHaveLength(2);
        expect(result.state.endpoints).toHaveLength(1);
        expect(Object.isFrozen(result.state.layouts[0].placements[0].rect)).toBe(true);
        expect(safeInvoke).toHaveBeenCalledWith('wall_request', { operation: { kind: 'state' } });
        state.revision = 8;
        expect(result.state.revision).toBe(7);
    });

    it('rejects a response associated with another authenticated device', async () => {
        vi.mocked(safeInvoke).mockResolvedValue({ deviceId: 'computer-b', body: snapshot() });
        await expect(wallApi.readState()).rejects.toThrow('another device');
    });

    it('passes native failures through without blindly retrying a mutation', async () => {
        const failure = { code: 'wall_request_rejected', status: 409 };
        vi.mocked(safeInvoke).mockRejectedValue(failure);
        const outcome = await wallApi.remove(7, 'endpoint-left').then(
            () => ({ accepted: true }), (error: unknown) => ({ error }),
        );
        expect(outcome).toEqual({ error: failure });
        expect(safeInvoke).toHaveBeenCalledTimes(1);
    });

    it('checks presenter leases and acknowledgements before accepting them', async () => {
        const body = { protocolVersion: WALL_PROTOCOL_VERSION, leaseId: 'lease-1', leaseTtlMs: 15_000 };
        vi.mocked(safeInvoke).mockResolvedValue({ deviceId: 'computer-a', body });
        expect((await wallApi.connect('endpoint-left')).leaseTtlMs).toBe(15_000);
        vi.mocked(safeInvoke).mockResolvedValue({ deviceId: 'computer-a', body: { ...body, leaseTtlMs: 0 } });
        await expect(wallApi.connect('endpoint-left')).rejects.toThrow('leaseTtlMs');
        vi.mocked(safeInvoke).mockResolvedValue({ deviceId: 'computer-a', body: { protocolVersion: WALL_PROTOCOL_VERSION, accepted: false } });
        await expect(wallApi.heartbeat('endpoint-left', 'lease-1', 1, 7)).rejects.toThrow('acknowledgement');
    });
});

describe('wall state acceptance', () => {
    it('rejects conflicting topology, stale applied revisions and oversized catalogs', () => {
        const state = snapshot();
        const layout = state.layouts[0];
        for (const value of [
            { ...state, revision: 6 },
            { ...state, revision: 0, layouts: [] },
            { ...state, layouts: [layout, layout] },
            { ...state, layouts: [layout, { ...layout, wallId: 'another-wall' }] },
            { ...state, endpoints: [state.endpoints[0], state.endpoints[0]] },
            { ...state, endpoints: [{ ...state.endpoints[0], appliedRevision: 6 }] },
            { ...state, endpoints: [{ ...state.endpoints[0], online: false, appliedRevision: 7 }] },
            { ...state, layouts: Array.from({ length: 65 }, () => layout) },
            { ...state, endpoints: Array.from({ length: 257 }, () => state.endpoints[0]) },
            { ...state, extra: true },
        ]) expect(() => parseWallState(value)).toThrow('Invalid wall contract');
        state.endpoints[0].appliedRevision = 7;
        expect(() => parseWallState(state)).not.toThrow();
    });

    it('accepts an empty initial catalog and offline unassigned endpoints', () => {
        expect(parseWallState({ protocolVersion: WALL_PROTOCOL_VERSION, revision: 0, endpoints: [], layouts: [] }).revision).toBe(0);
        const state = snapshot();
        state.layouts = [];
        state.endpoints[0].online = false;
        expect(parseWallState(state).endpoints[0].appliedRevision).toBeNull();
    });
});
