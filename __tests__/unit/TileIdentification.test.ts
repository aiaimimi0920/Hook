import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTileIdentification } from '../../src/services/tileIdentification';
import { WALL_PROTOCOL_VERSION, type TileEndpoint } from '../../src/services/wallTypes';

const endpoint: TileEndpoint = { protocolVersion: WALL_PROTOCOL_VERSION, endpointId: 'tile', deviceId: 'device', outputId: 'screen',
    pixelSize: { width: 1920, height: 1080 }, renderModes: ['image'], inputCapabilities: [], display: { name: 'Display 1', canIdentify: true } };
const command = { requestId: 'request', remainingMs: 10000, applied: false };
function fixture() {
    const show = vi.fn(), pause = vi.fn(), report = vi.fn().mockResolvedValue(undefined);
    return { show, pause, report, controller: createTileIdentification(show, pause, report) };
}
describe('physical display identification lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
        vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

    it('reports an actual paint then expires without extending or replaying a duplicate snapshot', async () => {
        const f = fixture(), applying = f.controller.apply(command, endpoint, 'lease', 0);
        expect(f.pause).toHaveBeenCalledOnce(); expect(f.report).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(16); expect(await applying).toBe(true);
        expect(f.report).toHaveBeenCalledWith('tile', 'lease', 'request', 'applied');
        await vi.advanceTimersByTimeAsync(8984);
        expect(await f.controller.apply(command, endpoint, 'lease', performance.now())).toBe(true);
        await vi.advanceTimersByTimeAsync(1000);
        expect(f.controller.active()).toBe(false); expect(f.show).toHaveBeenLastCalledWith(null);
        expect(await f.controller.apply(command, endpoint, 'lease', performance.now())).toBe(false);
        expect(f.report).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    });

    it('does not show a state response whose original read consumed the entire deadline', async () => {
        const f = fixture(); await vi.advanceTimersByTimeAsync(10001);
        expect(await f.controller.apply(command, endpoint, 'lease', 0)).toBe(false);
        expect(f.pause).not.toHaveBeenCalled(); expect(f.report).not.toHaveBeenCalled();
        expect(f.controller.active()).toBe(false);
    });

    it('bounds a hidden WebView paint and clears a marker before a late applied report', async () => {
        const f = fixture(); vi.stubGlobal('requestAnimationFrame', () => 0);
        const applying = f.controller.apply(command, endpoint, 'lease', 0);
        await vi.advanceTimersByTimeAsync(500);
        expect(await applying).toBe(false); expect(f.report).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        const next = f.controller.apply({ ...command, requestId: 'next' }, endpoint, 'lease', performance.now());
        f.controller.clear(); expect(await next).toBe(false);
        expect(f.report).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });

    it('serializes dismissal behind applied acknowledgement and never reopens the dismissed request', async () => {
        const f = fixture(); let finish!: () => void;
        f.report.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
        const applying = f.controller.apply(command, endpoint, 'lease', 0);
        await vi.advanceTimersByTimeAsync(16);
        const dismissing = f.controller.dismiss();
        await f.controller.dismiss(); expect(f.report).toHaveBeenCalledOnce();
        finish(); await applying; await dismissing;
        expect(f.report.mock.calls.map((call) => call[3])).toEqual(['applied', 'dismissed']);
        expect(await f.controller.apply(command, endpoint, 'lease', 0)).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('invalidates a pending report on output loss without letting it clear the next lease', async () => {
        const f = fixture(); let finish!: () => void;
        f.report.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
        const first = f.controller.apply(command, endpoint, 'old-lease', 0);
        await vi.advanceTimersByTimeAsync(16);
        const dismissing = f.controller.dismiss(); f.controller.clear();
        const next = f.controller.apply(command, endpoint, 'new-lease', performance.now());
        await vi.advanceTimersByTimeAsync(16); expect(await next).toBe(true);
        finish(); await first; await dismissing;
        expect(f.report.mock.calls.map((call) => [call[1], call[3]])).toEqual([['old-lease', 'applied'], ['new-lease', 'applied']]);
        expect(f.controller.active()).toBe(true); f.controller.clear(); expect(vi.getTimerCount()).toBe(0);
    });
});
