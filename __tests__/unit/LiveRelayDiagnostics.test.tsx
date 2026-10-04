// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { liveRelayDiagnostic } from '../../src/services/liveRelayDiagnostics';
import { LiveRelayLayer } from '../../src/components/LiveRelayLayer';
import { createLiveRelayController } from '../../src/services/liveRelayController';
import { liveRelayActions, liveRelayViews } from '../../src/store/liveRelayStore';
import { relayStatus } from '../fixtures/liveRelay';
import type { LiveRelayView, LiveRelayFrameDescriptor } from '../../src/services/liveRelay';
import type { LiveRelayPresentation } from '../../src/services/liveRelayPresentation';

vi.mock('../../src/services/syncService', () => ({ syncService: { updateBackendRects: async () => undefined } }));
vi.mock('../../src/services/api', () => ({ api: { stopLiveRelaySession: async () => undefined } }));
const presentation: LiveRelayPresentation = {
    liveSessionId: 'live:a', epoch: 1, frameId: 7, generation: 2, evidence: 'decoded_submitted', codec: 'jpeg',
    payloadBytes: 128, imageBytes: 128, readMs: 2, prepareMs: 1, decodeMs: 3, submittedAtMs: 100,
    captureTimestampMs: 200, encodeTimestampMs: 201, receivedTimestampMs: 300,
};
const frame: LiveRelayFrameDescriptor = {
    relayId: 'relay:a', liveSessionId: 'live:a', epoch: 1, frameId: 7, codec: 'jpeg', width: 4, height: 4,
    colorSpace: 'srgb', byteLength: 128, captureTimestampMs: 200, encodeTimestampMs: 201, receivedTimestampMs: 300, droppedFrames: 0,
};
const view = (): LiveRelayView => ({
    relayId: 'relay:a', status: { ...relayStatus }, title: 'private-window-title', imageUrl: 'blob:private-pixels',
    sourceIdentity: { deviceId: 'source:a', hookId: 'hook:a' }, submittedFrameId: 7,
    frameWidth: 4, frameHeight: 4, x: 0, y: 0, width: 320, height: 240, pinned: false, zIndex: 1,
    presentation: { ...presentation }, controlError: 'private-token-in-error',
});
let unmount: (() => void) | undefined;
beforeEach(() => liveRelayActions.clear());
afterEach(() => { unmount?.(); unmount = undefined; liveRelayActions.clear(); document.body.replaceChildren(); });

it('exports only bounded identity, received counters and decoded submission stages', () => {
    const sample = liveRelayDiagnostic(view());
    expect(sample).toMatchObject({ path: 'live_relay', sourceDeviceId: 'source:a', sourceHookId: 'hook:a', epoch: 1,
        packageBinding: 'external_process_sha256_required', presentation: { generation: 2, frameId: 7, codec: 'jpeg',
            payloadBytes: 128, imageBytes: 128, readMs: 2, prepareMs: 1, decodeMs: 3, submittedAtMs: 100 } });
    expect(sample.buildVersion).toMatch(/^v\d+\.\d+\.\d+\.\d+$/);
    expect(JSON.stringify(sample)).not.toContain('private');
    expect(sample).not.toHaveProperty('fps');
    expect(sample).not.toHaveProperty('endToEndLatencyMs');
});

it.each(['closed', 'relay', 'epoch', 'session', 'frame', 'no-pixels'] as const)('does not expose stale submission after %s', (reason) => {
    const current = view();
    if (reason === 'closed') current.status.connectionState = 'closed';
    if (reason === 'relay') current.status.relayId = 'relay:b';
    if (reason === 'epoch') current.status.epoch = 2;
    if (reason === 'session') current.status.liveSessionId = 'live:b';
    if (reason === 'frame') current.submittedFrameId = 9;
    if (reason === 'no-pixels') current.imageUrl = undefined;
    expect(liveRelayDiagnostic(current).presentation).toBeNull();
});

it('rejects control characters and bounds the serialized slot for maximum valid identities', () => {
    const current = view(); current.sourceIdentity!.hookId = '\n'.repeat(256);
    expect(liveRelayDiagnostic(current).sourceHookId).toBeNull();
    current.relayId = current.status.relayId = 'a'.repeat(256);
    current.status.liveSessionId = current.presentation!.liveSessionId = 'b'.repeat(256);
    current.sourceIdentity = { deviceId: 'c'.repeat(256), hookId: 'd'.repeat(256) };
    expect(JSON.stringify(liveRelayDiagnostic(current)).length).toBeLessThan(4096);
});

it('keeps a previously decoded frame identifiable during a later decoder failure', () => {
    const current = view(); current.status.lastFrameId = 8;
    const sample = liveRelayDiagnostic(current);
    expect(sample.hasError).toBe(true);
    expect(sample.presentation?.frameId).toBe(7);
});

it('rejects unsafe numeric and oversized identity values without copying unknown fields', () => {
    const current = view(); current.sourceIdentity!.deviceId = 'x'.repeat(10_000);
    current.status.receivedFrames = Number.MAX_SAFE_INTEGER + 1;
    current.presentation!.readMs = Number.NaN;
    Object.assign(current.presentation!, { unknownField: 'private' });
    const sample = liveRelayDiagnostic(current);
    expect(sample.sourceDeviceId).toBeNull(); expect(sample.receivedFrames).toBeNull();
    expect(sample.presentation?.readMs).toBeNull();
    expect(JSON.stringify(sample).length).toBeLessThan(4096);
    expect(JSON.stringify(sample)).not.toContain('private');
});

it('exposes the viewer DOM slot, invalidates it on epoch change and removes it through controller stop', async () => {
    liveRelayActions.add({ ...relayStatus }, 'private-title', { x: 0, y: 0, width: 320, height: 240 },
        { deviceId: 'source:a', hookId: 'hook:a' });
    const controller = createLiveRelayController();
    unmount = render(() => <LiveRelayLayer controller={controller} />, document.body);
    const read = () => JSON.parse(document.querySelector('[data-live-relay-diagnostic]')!.getAttribute('data-live-relay-diagnostic')!);
    expect(read().presentation).toBeNull();
    liveRelayActions.updateFrame('relay:a', 'blob:frame', frame, presentation);
    expect(read().presentation.frameId).toBe(7);
    liveRelayActions.updateStatus('relay:a', { ...relayStatus, epoch: 2 });
    expect(read().presentation).toBeNull();
    liveRelayActions.clearFrame('relay:a');
    expect(liveRelayViews[0].presentation).toBeUndefined();
    await controller.stop('relay:a');
    expect(document.querySelector('[data-live-relay-diagnostic]')).toBeNull();
    controller.dispose();
});
