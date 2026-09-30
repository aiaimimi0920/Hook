import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixtureText from '../fixtures/wall/wall-geometry.v1.json?raw';
import { createTileInputController } from '../../src/services/tileInputController';
import type { wallInputApi, WallInputEvent } from '../../src/services/apiWallInput';
import type { TileEndpoint, WallLayout } from '../../src/services/wallTypes';

const data = JSON.parse(fixtureText) as { layout: WallLayout; endpoints: TileEndpoint[] };
const down: WallInputEvent = { kind: 'button', pixel: { x: 0, y: 0 }, pointerId: 1, button: 'left', state: 'pressed', clickCount: 1 };
const up: WallInputEvent = { ...down, state: 'released' };
const grant = { protocolVersion: 'loom.wall.v1', endpointId: 'endpoint-left', revision: 7, controlId: 'control-1',
    placementId: 'application', sessionId: 'live-1', leaseTtlMs: 4000 };
async function settle() { for (let index = 0; index < 30; index++) await Promise.resolve(); }
function fixture() {
    const api = { acquire: vi.fn().mockResolvedValue(grant), send: vi.fn().mockResolvedValue(undefined),
        renew: vi.fn().mockResolvedValue(undefined), release: vi.fn().mockResolvedValue(undefined) } satisfies typeof wallInputApi;
    const notice = vi.fn(); const input = createTileInputController(notice, api);
    input.update(data.layout, data.endpoints[0], 'lease-1', 7);
    return { api, input, notice };
}
describe('endpoint input lifetime', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('releases a late authority grant after focus loss without sending queued edges', async () => {
        const { api, input } = fixture();
        let resolve!: (value: typeof grant) => void;
        api.acquire.mockImplementation(() => new Promise((done) => { resolve = done; }));
        input.send(down); input.send(up); await settle();
        input.cancel(); resolve(grant); await settle(); await input.stop();
        expect(api.send).not.toHaveBeenCalled(); expect(api.release).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves button and key ordering while coalescing only adjacent moves', async () => {
        const { api, input } = fixture();
        input.send(down);
        for (let x = 1; x <= 20; x++) input.send({ kind: 'move', pixel: { x, y: 0 }, pointerId: 1 });
        input.send(up);
        input.send({ kind: 'key', virtualKey: 65, state: 'pressed' });
        input.send({ kind: 'key', virtualKey: 65, state: 'released' });
        await settle();
        expect(api.send.mock.calls.map((call) => call[2])).toEqual([1, 2, 3, 4, 5]);
        expect(api.send.mock.calls.map((call) => call[3].kind)).toEqual(['button', 'move', 'button', 'key', 'key']);
        expect(api.send.mock.calls[1][3]).toMatchObject({ pixel: { x: 20, y: 0 } });
        await input.stop(); expect(api.release).toHaveBeenCalledTimes(1);
    });

    it('revokes on a revision switch and ignores keys until the new content is clicked', async () => {
        const { api, input } = fixture(); input.send(down); await settle();
        input.update({ ...data.layout, revision: 8 }, data.endpoints[0], 'lease-1', 8);
        input.send({ kind: 'key', virtualKey: 65, state: 'pressed' }); await settle();
        expect(api.release).toHaveBeenCalledTimes(1); expect(api.send).toHaveBeenCalledTimes(1);
        await input.stop();
    });

    it('fails closed after a delayed reliable edge rather than replaying old input', async () => {
        const { api, input, notice } = fixture();
        let finish!: () => void;
        api.send.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
        input.send(down); await settle(); input.send(up);
        await vi.advanceTimersByTimeAsync(1600); finish(); await settle();
        expect(api.send).toHaveBeenCalledTimes(1); expect(api.release).toHaveBeenCalledTimes(1);
        expect(notice).toHaveBeenCalledWith('wall_input_late'); await input.stop();
    });

    it('bounds reliable backlog and does not retry a rejected acquisition', async () => {
        const { api, input, notice } = fixture();
        api.acquire.mockRejectedValueOnce({ code: 'wall_request_rejected', status: 409 });
        input.send(down); input.send(up); await settle();
        expect(api.acquire).toHaveBeenCalledTimes(1); expect(api.send).not.toHaveBeenCalled();
        expect(notice).toHaveBeenCalledWith('wall_request_rejected');
        let resolve!: (value: typeof grant) => void;
        api.acquire.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
        input.send(down); await settle();
        for (let i = 0; i < 65; i++) input.send({ kind: 'key', virtualKey: 65, state: 'pressed' });
        resolve(grant); await settle();
        expect(notice).toHaveBeenCalledWith('wall_input_queue_full'); expect(api.send).not.toHaveBeenCalled();
        await input.stop();
    });

    it('does not acquire authority while a layout has not been acknowledged', async () => {
        const { api, input } = fixture(); input.update(data.layout, data.endpoints[0], 'lease-1', null);
        input.send(down); await settle(); expect(api.acquire).not.toHaveBeenCalled(); await input.stop();
    });

    it('makes competing-source authority visible and never replays the rejected gesture', async () => {
        const { api, input, notice } = fixture();
        api.acquire.mockRejectedValueOnce({ code: 'wall_control_conflict', status: 409 });
        input.send(down); input.send(up); await settle();
        await vi.advanceTimersByTimeAsync(5000);
        expect(api.acquire).toHaveBeenCalledOnce(); expect(api.send).not.toHaveBeenCalled();
        expect(notice).toHaveBeenCalledWith(expect.stringContaining('其他终端'));
        input.send(down); input.send(up); await settle();
        expect(api.acquire).toHaveBeenCalledTimes(2); expect(api.send).toHaveBeenCalledTimes(2);
        await input.stop();
    });

    it('waits for the owned release when a move leaves the content during a new drain', async () => {
        const { api, input } = fixture();
        const placement = data.layout.placements[0];
        input.update({ ...data.layout, placements: [{ ...placement, rect: { ...placement.rect, width: 50 } }] },
            data.endpoints[0], 'lease-1', 7);
        input.send(down); await settle();
        let finish!: () => void;
        api.release.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
        input.send({ kind: 'move', pixel: { x: 75, y: 0 }, pointerId: 1 }); await settle();
        let stopped = false;
        const stopping = input.stop().then(() => { stopped = true; });
        await settle();
        try {
            expect(api.release).toHaveBeenCalledTimes(1);
            expect(stopped).toBe(false);
        } finally {
            finish(); await stopping;
        }
        expect(api.send).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
