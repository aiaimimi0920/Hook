import { describe, expect, it, vi } from 'vitest';
import { createTileClock } from '../../src/services/tileClock';
import { createTileSceneGate } from '../../src/services/tileSceneGate';
import { parseWallState } from '../../src/services/wallProtocol';

describe('wall clock and complete scene switch', () => {
    it('uses a bounded RTT estimate and waits past the earliest possible server deadline', () => {
        let local = 20;
        const clock = createTileClock(() => local), visible = vi.fn();
        clock.observe({ clockId: 'boot-a', serverTimeMs: 1010, scenes: [] }, 0, 20);
        const gate = createTileSceneGate(clock, visible);
        gate.begin('lease:revision:1', { wallId: 'wall', revision: 1, preparedAtMs: 1000, activateAtMs: 1100 });
        expect(gate.permit(true)).toBe(false);
        expect(gate.report()?.prepared).toBe(true);
        expect(gate.report()?.appliedAtMs).toBeNull();
        local = 100;
        expect(gate.permit(true)).toBe(false);
        local = 113;
        expect(gate.permit(true)).toBe(true); gate.applied();
        expect(visible).toHaveBeenLastCalledWith(true);
        const first = gate.report()?.appliedAtMs;
        local = 150; gate.applied();
        expect(gate.report()?.appliedAtMs).toBe(first);
        gate.begin('lease:revision:2', { wallId: 'wall', revision: 2, preparedAtMs: 1100, activateAtMs: 1200 });
        expect(visible).toHaveBeenLastCalledWith(false);
        expect(gate.report()?.appliedAtMs).toBeNull();
    });
    it('rejects slow samples, forgets another daemon boot, and expires an abandoned estimate', () => {
        let local = 10;
        const clock = createTileClock(() => local);
        expect(clock.observe({ clockId: 'boot-a', serverTimeMs: 5000, scenes: [] }, 0, 10)).toBe(false);
        expect(clock.estimate()?.uncertaintyMs).toBe(6);
        local = 2000;
        expect(clock.observe({ clockId: 'boot-b', serverTimeMs: 9000, scenes: [] }, 0, 2000)).toBe(true);
        expect(clock.estimate()).toBeUndefined();
        clock.observe({ clockId: 'boot-b', serverTimeMs: 9000, scenes: [] }, 1990, 2000);
        local = 18000;
        expect(clock.estimate()).toBeUndefined();
    });
    it('will not make a prepared scene visible without a current clock', () => {
        const clock = createTileClock(() => 0), gate = createTileSceneGate(clock, vi.fn());
        gate.begin('a', { wallId: 'wall', revision: 1, preparedAtMs: 1, activateAtMs: 2 });
        expect(gate.permit(true)).toBe(false);
        expect(gate.report()?.clockUncertaintyMs).toBeNull();
        gate.clear(); expect(gate.report()).toBeUndefined();
    });
    it('strictly validates clock fields and scene coverage', () => {
        const state = { protocolVersion: 'loom.wall.v1', revision: 0, endpoints: [], layouts: [],
            timing: { clockId: 'boot', serverTimeMs: 100, scenes: [] } };
        expect(parseWallState(state).timing?.clockId).toBe('boot');
        expect(() => parseWallState({ ...state, timing: { ...state.timing, extra: true } })).toThrow();
        expect(() => parseWallState({ ...state, timing: { ...state.timing, serverTimeMs: Number.MAX_VALUE } })).toThrow();
        expect(() => parseWallState({ ...state, timing: { ...state.timing,
            scenes: [{ wallId: 'missing', revision: 1, preparedAtMs: 1, activateAtMs: 50 }] } })).toThrow();
    });
    it('does not acknowledge a paint if its clock estimate expired after preparation', () => {
        let local = 10;
        const clock = createTileClock(() => local), visible = vi.fn(), gate = createTileSceneGate(clock, visible);
        clock.observe({ clockId: 'boot', serverTimeMs: 1000, scenes: [] }, 0, 10);
        gate.begin('a', { wallId: 'wall', revision: 1, preparedAtMs: 900, activateAtMs: 950 });
        expect(gate.permit(true)).toBe(true);
        local = 20000;
        expect(gate.applied()).toBe(false);
        expect(gate.report()?.appliedAtMs).toBeNull(); expect(visible).toHaveBeenLastCalledWith(false);
    });
});
