import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTilePresenter, tileEndpointId, type TilePresenterHost } from '../../src/services/tilePresenter';
import type { wallApi } from '../../src/services/apiWall';
import { WALL_PROTOCOL_VERSION, type TileEndpoint, type WallPresenterLease, type WallStateSnapshot } from '../../src/services/wallTypes';

const output = { outputId: `monitor-${'a'.repeat(64)}`, name: 'test display', x: -1920, y: 0, width: 1920, height: 1080 };
const lease: WallPresenterLease = { protocolVersion: WALL_PROTOCOL_VERSION, leaseId: 'lease-1', leaseTtlMs: 15000 };
async function fixture() {
    const endpointId = await tileEndpointId('device-1', output.outputId);
    const endpoint: TileEndpoint = { protocolVersion: WALL_PROTOCOL_VERSION, endpointId, deviceId: 'device-1', outputId: output.outputId,
        pixelSize: { width: 1920, height: 1080 }, renderModes: ['image', 'raw_bgra'], inputCapabilities: [] };
    const state: WallStateSnapshot = { protocolVersion: WALL_PROTOCOL_VERSION, revision: 3,
        endpoints: [{ endpoint, online: false, appliedRevision: null }], layouts: [] };
    const response = { deviceId: 'device-1', state };
    const api = { readState: vi.fn().mockResolvedValue(response), register: vi.fn().mockResolvedValue(response),
        remove: vi.fn().mockResolvedValue(response), connect: vi.fn().mockResolvedValue(lease),
        heartbeat: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined),
        reportIdentification: vi.fn().mockResolvedValue(undefined) } satisfies typeof wallApi;
    const host: TilePresenterHost = { output: vi.fn().mockResolvedValue(output), apply: vi.fn().mockResolvedValue({ appliedRevision: null }),
        clear: vi.fn(), status: vi.fn() };
    return { api, host, endpoint, state };
}
// Native WebCrypto completion is an actual async boundary even under fake timers.
async function eventually(check: () => boolean) {
    for (let i = 0; i < 100 && !check(); i++) await new Promise<void>((resolve) => setImmediate(resolve));
    expect(check()).toBe(true);
}
describe('tile presenter resource ownership', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }); });
    afterEach(() => { vi.useRealTimers(); });

    it('identifies an unassigned output without waiting for content and without granting input', async () => {
        const { api, host, state, endpoint } = await fixture();
        const identifiedEndpoint = { ...endpoint, display: { name: output.name, canIdentify: true } };
        const command = { requestId: 'command-1', remainingMs: 10000, applied: false };
        api.readState.mockResolvedValue({ deviceId: 'device-1', state: { ...state,
            endpoints: [{ endpoint: identifiedEndpoint, online: true, appliedRevision: null, identification: command }] } });
        host.identify = vi.fn().mockResolvedValue(true); host.presented = vi.fn();
        const presenter = createTilePresenter(host, api); presenter.start();
        await eventually(() => api.heartbeat.mock.calls.length === 1);
        expect(host.identify).toHaveBeenCalledWith(command, identifiedEndpoint, 'lease-1', expect.any(Number));
        expect(host.apply).not.toHaveBeenCalled();
        expect(api.heartbeat.mock.calls[0][3]).toBeNull();
        expect(host.presented).toHaveBeenCalledWith(null, identifiedEndpoint, 'lease-1', null);
        await presenter.stop(); expect(vi.getTimerCount()).toBe(0);
    });

    it('acknowledges presentation controls independently and never reauthorizes frozen input', async () => {
        const { api, host, state, endpoint } = await fixture();
        const layout = { protocolVersion: WALL_PROTOCOL_VERSION, wallId: 'wall', revision: 3,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 }, placements: [],
            tiles: [{ tileId: 'tile', endpointId: endpoint.endpointId, rect: { x: 0, y: 0, width: 1920, height: 1080 }, rotation: 'deg0' as const }] };
        const control = { wallId: 'wall', revision: 4, mode: 'frozen' as const };
        const report = { revision: 4, outcome: 'applied' as const };
        api.readState.mockResolvedValue({ deviceId: 'device-1', state: { ...state, revision: 4, layouts: [layout], presentations: [control] } });
        vi.mocked(host.apply).mockResolvedValue({ appliedRevision: 3, presentation: report });
        host.presented = vi.fn();
        const presenter = createTilePresenter(host, api); presenter.start();
        await eventually(() => vi.mocked(host.presented!).mock.calls.length === 1);
        expect(host.apply).toHaveBeenCalledWith(layout, endpoint, 'lease-1', control);
        expect(api.heartbeat).toHaveBeenCalledWith(endpoint.endpointId, 'lease-1', 1, 3, report);
        expect(host.presented).toHaveBeenCalledWith(layout, endpoint, 'lease-1', null);
        await presenter.stop(); expect(vi.getTimerCount()).toBe(0);
    });

    it('disconnects a late connect response after stop without drawing or heartbeating', async () => {
        const { api, host } = await fixture();
        let grant!: (value: WallPresenterLease) => void;
        api.connect.mockImplementation(() => new Promise<WallPresenterLease>((resolve) => { grant = resolve; }));
        const presenter = createTilePresenter(host, api); presenter.start();
        await eventually(() => api.connect.mock.calls.length === 1);
        const stopping = presenter.stop(); grant(lease); await stopping;
        expect(api.disconnect).toHaveBeenCalledTimes(1);
        expect(host.apply).not.toHaveBeenCalled(); expect(api.heartbeat).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not advertise input; unsupported content is acknowledged as unapplied', async () => {
        const { api, host, state } = await fixture();
        const presenter = createTilePresenter(host, api); presenter.start();
        await eventually(() => api.heartbeat.mock.calls.length === 1);
        expect(api.register).not.toHaveBeenCalled();
        expect(state.endpoints[0].endpoint.inputCapabilities).toEqual([]);
        expect(api.heartbeat.mock.calls[0][3]).toBeNull();
        await presenter.stop(); expect(api.disconnect).toHaveBeenCalledTimes(1);
    });

    it('losing the physical output clears the frame and releases its lease', async () => {
        const { api, host } = await fixture();
        const presenter = createTilePresenter(host, api); presenter.start();
        await eventually(() => api.heartbeat.mock.calls.length === 1);
        await eventually(() => vi.getTimerCount() >= 1);
        vi.mocked(host.output).mockRejectedValue('tile_output_disconnected');
        await vi.advanceTimersByTimeAsync(3000);
        expect(host.clear).toHaveBeenCalledWith('tile_output_disconnected');
        expect(api.disconnect).toHaveBeenCalledTimes(1);
        expect(api.heartbeat).toHaveBeenCalledTimes(1);
        await presenter.stop();
    });

    it('rejects output pixel budgets before pairing or registration', async () => {
        const { api, host } = await fixture();
        vi.mocked(host.output).mockResolvedValue({ ...output, width: 16384, height: 16384 });
        const presenter = createTilePresenter(host, api); presenter.start();
        await eventually(() => vi.mocked(host.clear).mock.calls.length > 0);
        expect(host.clear).toHaveBeenCalledWith('tile_canvas_pixel_limit');
        expect(api.readState).not.toHaveBeenCalled(); await presenter.stop();
    });

    it('output identity is stable and scoped to the paired device', async () => {
        expect(await tileEndpointId('device-1', output.outputId)).toBe(await tileEndpointId('device-1', output.outputId));
        expect(await tileEndpointId('device-1', output.outputId)).not.toBe(await tileEndpointId('device-2', output.outputId));
    });

    it('detects a lost output while a network read is still pending and rejects its late result', async () => {
        const { api, host } = await fixture();
        const presenter = createTilePresenter(host, api); presenter.start();
        await eventually(() => api.heartbeat.mock.calls.length === 1);
        await eventually(() => vi.getTimerCount() > 0);
        const response = await api.readState.mock.results[0].value;
        let finish!: (value: typeof response) => void;
        api.readState.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        await vi.advanceTimersByTimeAsync(3000);
        await eventually(() => api.readState.mock.calls.length === 2);
        vi.mocked(host.output).mockRejectedValue('tile_output_disconnected');
        await vi.advanceTimersByTimeAsync(1000);
        try {
            expect(host.clear).toHaveBeenCalledWith('tile_output_disconnected');
            expect(api.heartbeat).toHaveBeenCalledTimes(1);
        } finally {
            finish(response); await presenter.stop();
        }
        expect(host.apply).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('clears a static presentation when heartbeat stalls and never reauthorizes its late reply', async () => {
        const { api, host } = await fixture();
        host.presented = vi.fn();
        const presenter = createTilePresenter(host, api); presenter.start();
        await eventually(() => vi.mocked(host.presented!).mock.calls.length === 1);
        let finish!: () => void;
        api.heartbeat.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
        await vi.advanceTimersByTimeAsync(3000);
        await eventually(() => api.heartbeat.mock.calls.length === 2);
        await vi.advanceTimersByTimeAsync(3500);
        try {
            expect(host.clear).toHaveBeenCalledWith('tile_authorization_timeout');
        } finally {
            finish(); await presenter.stop();
        }
        expect(host.presented).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
