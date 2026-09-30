import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/services/api';
import { createLiveRelayController, type LiveRelayController } from '../../src/services/liveRelayController';
import type { LiveRelaySnapshot } from '../../src/services/liveRelay';
import { liveRelayActions, liveRelayViews } from '../../src/store/liveRelayStore';

vi.mock('../../src/services/api', () => ({ api: {
    publishLiveCaptureToLoom: vi.fn(), stopLiveRelaySession: vi.fn(), discoverLiveRelaySessions: vi.fn(),
} }));
const source: LiveRelaySnapshot = { relayId: 'relay:a', liveSessionId: 'live:a', captureSessionId: 'capture:a',
    role: 'source', connectionState: 'connected', epoch: 1, lastFrameId: 0, receivedFrames: 0, reconnectCount: 0,
    overwrittenFrames: 0, controllerOwned: false, remoteControlActive: false, lastInputSequence: 0,
    mediaTransport: 'websocket_binary', networkScope: 'loopback_http', latencyState: 'unavailable',
    observationCapabilities: [], observationState: 'unsupported', observations: [], triggers: [], triggerAudits: [] };
const owners: LiveRelayController[] = [];
const owner = () => { const controller = createLiveRelayController(); owners.push(controller); return controller; };
beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks(); liveRelayActions.clear();
    vi.mocked(api.stopLiveRelaySession).mockResolvedValue(undefined);
    vi.mocked(api.discoverLiveRelaySessions).mockResolvedValue({ protocolVersion: 'loom.live.v1', sessions: [] });
});
afterEach(() => { owners.splice(0).forEach((controller) => controller.dispose()); vi.useRealTimers(); });

describe('capture publication ownership', () => {
    it('coalesces publication requests from reopened Unit panels and keeps the original capture owner', async () => {
        let finish!: (value: LiveRelaySnapshot) => void;
        vi.mocked(api.publishLiveCaptureToLoom).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        const controller = owner();
        const first = controller.publish('capture:a', 'Source', { width: 200, height: 100 });
        const second = controller.publish('capture:a', 'Reopened panel', { width: 200, height: 100 });
        await Promise.resolve(); expect(api.publishLiveCaptureToLoom).toHaveBeenCalledOnce();
        finish(source); await Promise.all([first, second]);
        await controller.publish('capture:a', 'Again', { width: 200, height: 100 });
        expect(api.publishLiveCaptureToLoom).toHaveBeenCalledOnce(); expect(liveRelayViews).toHaveLength(1);
    });
    it('stops a late successful native publication after the runtime owner has been disposed', async () => {
        let finish!: (value: LiveRelaySnapshot) => void;
        vi.mocked(api.publishLiveCaptureToLoom).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        const controller = owner(), pending = controller.publish('capture:a', 'Source', { width: 200, height: 100 });
        await Promise.resolve(); controller.dispose(); finish(source); await pending;
        expect(api.stopLiveRelaySession).toHaveBeenCalledWith('relay:a');
        expect(liveRelayViews).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
        expect(api.discoverLiveRelaySessions).not.toHaveBeenCalled();
    });
    it('retains successful publication when read-only discovery fails', async () => {
        vi.mocked(api.publishLiveCaptureToLoom).mockResolvedValue(source);
        vi.mocked(api.discoverLiveRelaySessions).mockRejectedValue(new Error('catalog unavailable'));
        await owner().publish('capture:a', 'Source', { width: 200, height: 100 });
        expect(liveRelayViews).toHaveLength(1); expect(liveRelayViews[0].controlError).toBe('catalog unavailable');
    });
});
