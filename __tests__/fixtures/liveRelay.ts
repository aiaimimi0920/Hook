import type { LiveRelaySessionSummary, LiveRelaySnapshot } from '../../src/services/liveRelay';
import { SURFACE_PROTOCOL_VERSION, type SurfaceSnapshot } from '../../src/services/surfaceProtocol';

export const relayStatus: LiveRelaySnapshot = {
    relayId: 'relay:a', liveSessionId: 'live:a', role: 'viewer', connectionState: 'connected',
    epoch: 1, lastFrameId: 0, receivedFrames: 0, reconnectCount: 0, overwrittenFrames: 0,
    controllerOwned: false, remoteControlActive: false, lastInputSequence: 0,
    mediaTransport: 'websocket_binary', networkScope: 'loopback_http', latencyState: 'unavailable',
    observationCapabilities: [], observationState: 'unsupported', observations: [], triggers: [], triggerAudits: [],
};
export const relaySession: LiveRelaySessionSummary = {
    session: {
        sessionId: 'live:a', sourceDeviceId: 'source:a', sourceHookId: 'hook:a', sourceKind: 'region',
        sourceWindowIdentity: { title: '远端窗口' }, frameStream: { width: 4, height: 4, targetFps: 30 },
        interactionCapabilities: [], observationCapabilities: [], triggerBindings: [], viewerDevices: [],
    }, epoch: 1, sourceConnected: true, closed: false,
};
export const relaySurface: SurfaceSnapshot = {
    protocolVersion: SURFACE_PROTOCOL_VERSION, instanceId: 'instance:a', attachmentId: 'attachment:a',
    artId: 'test/surface', artVersion: '1.0.0', revision: 1, scene: { id: 'root', type: 'column' },
};
export const relayBinding = { unitId: 'unit:a', instanceId: 'instance:a', attachmentId: 'attachment:a', label: 'A' };

export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
