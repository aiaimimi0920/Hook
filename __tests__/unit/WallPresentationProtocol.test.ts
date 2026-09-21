import { describe, expect, it } from 'vitest';
import fixtureText from '../fixtures/wall/wall-geometry.v1.json?raw';
import { parseWallState } from '../../src/services/wallProtocol';
import { WALL_PROTOCOL_VERSION, type TileEndpoint, type WallLayout } from '../../src/services/wallTypes';

function snapshot() {
    const data = JSON.parse(fixtureText) as { layout: WallLayout; endpoints: TileEndpoint[] };
    return { protocolVersion: WALL_PROTOCOL_VERSION, revision: 8, layouts: [data.layout],
        presentations: [{ wallId: data.layout.wallId, revision: 8, mode: 'frozen' }],
        endpoints: [{ endpoint: data.endpoints[0], online: true, appliedRevision: 7,
            presentation: { revision: 8, outcome: 'applied' } }] };
}

describe('explicit wall presentation extension', () => {
    it('keeps a frozen layout distinct from its control revision and creates immutable reports', () => {
        const state = parseWallState(snapshot());
        expect(state.layouts[0].revision).toBe(7); expect(state.presentations?.[0].revision).toBe(8);
        expect(Object.isFrozen(state.presentations?.[0])).toBe(true); expect(Object.isFrozen(state.endpoints[0].presentation)).toBe(true);
        const missing = snapshot(); missing.endpoints[0].presentation.outcome = 'frame_unavailable';
        expect(parseWallState({ ...missing, endpoints: [{ ...missing.endpoints[0], appliedRevision: null }] }).endpoints[0].presentation?.outcome).toBe('frame_unavailable');
    });

    it('rejects unknown fields, duplicate or foreign controls, stale reports, and impossible outcomes', () => {
        const state = snapshot(), endpoint = state.endpoints[0], control = state.presentations[0];
        for (const value of [
            { ...state, presentations: null },
            { ...state, presentations: [control, control] },
            { ...state, presentations: [{ ...control, wallId: 'other-wall' }] },
            { ...state, presentations: [{ ...control, mode: 'running' }] },
            { ...state, presentations: [{ ...control, revision: 9 }] },
            { ...state, presentations: [{ ...control, extra: true }] },
            { ...state, endpoints: [{ ...endpoint, presentation: { revision: 7, outcome: 'applied' } }] },
            { ...state, endpoints: [{ ...endpoint, presentation: { revision: 8, outcome: 'future' } }] },
            { ...state, endpoints: [{ ...endpoint, presentation: { ...endpoint.presentation, extra: true } }] },
            { ...state, endpoints: [{ ...endpoint, presentation: null }] },
            { ...state, endpoints: [{ ...endpoint, online: false, appliedRevision: null }] },
            { ...state, endpoints: [{ ...endpoint, appliedRevision: null }] },
            { ...state, presentations: [{ ...control, mode: 'black' }] },
            { ...state, presentations: [] },
        ]) expect(() => parseWallState(value)).toThrow('Invalid wall contract');
        expect(parseWallState({ ...state, presentations: [{ ...control, mode: 'black' }],
            endpoints: [{ ...endpoint, appliedRevision: null }] }).endpoints[0].presentation?.outcome).toBe('applied');
    });
});
