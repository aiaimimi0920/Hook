/** Business DTOs only: pairing keys, bearer credentials and session nonces stay native. */
import { safeInvoke } from './apiTransport';
import { parseWallAccepted, parseWallClientResponse, parseWallPresenterLease, parseWallState } from './wallProtocol';
import type { TileEndpoint, WallPresentationReport, WallSceneReport } from './wallTypes';

type Operation =
    | { kind: 'state' }
    | { kind: 'register'; baseRevision: number; endpoint: Omit<TileEndpoint, 'deviceId'> }
    | { kind: 'remove'; baseRevision: number; endpointId: string }
    | { kind: 'connect'; endpointId: string }
    | { kind: 'heartbeat'; endpointId: string; leaseId: string; sequence: number; appliedRevision: number | null; presentation?: WallPresentationReport; scene?: WallSceneReport }
    | { kind: 'disconnect'; endpointId: string; leaseId: string }
    | { kind: 'identify_report'; endpointId: string; leaseId: string; requestId: string; outcome: 'applied' | 'dismissed' };

async function request(operation: Operation) {
    return parseWallClientResponse(await safeInvoke<unknown>('wall_request', { operation }));
}

async function stateRequest(operation: Operation) {
    const response = await request(operation);
    const state = parseWallState(response.body);
    if (state.endpoints.some((entry) => entry.endpoint.deviceId !== response.deviceId)) {
        throw new Error('Invalid wall contract: native response belongs to another device');
    }
    return Object.freeze({ deviceId: response.deviceId, state });
}

export const wallApi = {
    readState: () => stateRequest({ kind: 'state' }),
    register: (baseRevision: number, endpoint: Omit<TileEndpoint, 'deviceId'>) =>
        stateRequest({ kind: 'register', baseRevision, endpoint }),
    remove: (baseRevision: number, endpointId: string) => stateRequest({ kind: 'remove', baseRevision, endpointId }),
    connect: async (endpointId: string) => parseWallPresenterLease((await request({ kind: 'connect', endpointId })).body),
    heartbeat: async (endpointId: string, leaseId: string, sequence: number, appliedRevision: number | null, presentation?: WallPresentationReport, scene?: WallSceneReport) => {
        parseWallAccepted((await request({ kind: 'heartbeat', endpointId, leaseId, sequence, appliedRevision, ...(presentation ? { presentation } : {}), ...(scene ? { scene } : {}) })).body);
    },
    disconnect: async (endpointId: string, leaseId: string) => {
        parseWallAccepted((await request({ kind: 'disconnect', endpointId, leaseId })).body);
    },
    reportIdentification: async (endpointId: string, leaseId: string, requestId: string, outcome: 'applied' | 'dismissed') => {
        parseWallAccepted((await request({ kind: 'identify_report', endpointId, leaseId, requestId, outcome })).body);
    },
};
