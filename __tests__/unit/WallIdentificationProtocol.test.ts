import { describe, expect, it } from 'vitest';
import fixtureText from '../fixtures/wall/wall-geometry.v1.json?raw';
import { parseTileEndpoint, parseWallState } from '../../src/services/wallProtocol';
import { WALL_PROTOCOL_VERSION, type TileEndpoint, type WallLayout } from '../../src/services/wallTypes';

function snapshot() {
    const data = JSON.parse(fixtureText) as { layout: WallLayout; endpoints: TileEndpoint[] };
    return { protocolVersion: WALL_PROTOCOL_VERSION, revision: 7, layouts: [data.layout],
        endpoints: [{ endpoint: { ...data.endpoints[0], display: { name: 'Display 1', canIdentify: true } },
            online: true, appliedRevision: 7, identification: { requestId: 'request', remainingMs: 10000, applied: false } }] };
}

describe('lease-owned display identification contract', () => {
    it('preserves ordinary endpoints and freezes the independently acknowledged marker', () => {
        const data = JSON.parse(fixtureText) as { endpoints: TileEndpoint[] };
        expect(parseTileEndpoint(data.endpoints[0])).toEqual(data.endpoints[0]);
        const state = parseWallState(snapshot());
        expect(state.revision).toBe(7); expect(state.endpoints[0].appliedRevision).toBe(7);
        expect(state.endpoints[0].identification?.applied).toBe(false);
        expect(Object.isFrozen(state.endpoints[0].identification)).toBe(true);
        expect(Object.isFrozen(state.endpoints[0].endpoint.display)).toBe(true);
    });

    it('rejects malformed display labels, undeclared capability, offline or unbounded commands', () => {
        const state = snapshot(), row = state.endpoints[0], display = row.endpoint.display;
        const invalid = [
            ...[null, { ...display, extra: 1 }, { ...display, canIdentify: 'yes' }, { ...display, name: 'x'.repeat(257) },
                { ...display, name: 'bad\nname' }, { ...display, name: '  ' }]
                .map((display) => ({ ...row, endpoint: { ...row.endpoint, display } })),
            { ...row, endpoint: { ...row.endpoint, display: { ...display, canIdentify: false } } },
            { ...row, online: false, appliedRevision: null },
            ...[null, { ...row.identification, remainingMs: 10001 }, { ...row.identification, remainingMs: 0 },
                { ...row.identification, remainingMs: 1.5 }, { ...row.identification, extra: true }, { ...row.identification, applied: 'yes' }]
                .map((identification) => ({ ...row, identification })),
        ];
        for (const value of invalid) expect(() => parseWallState({ ...state, endpoints: [value] })).toThrow('Invalid wall contract');
        expect(() => parseWallState({ ...state, presentations: [{ wallId: state.layouts[0].wallId, revision: 7, mode: 'frozen' }] })).toThrow('identification authority');
    });
});
