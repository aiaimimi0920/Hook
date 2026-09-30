import type { TileEndpoint, WallLayout } from '../../../src/services/wallTypes';
import type { TileSurfaceState } from '../../../src/services/tileSurfaceCache';
import type { WallInputBinding } from '../../../src/services/apiWallInput';

export const binding: WallInputBinding = { endpointId: 'tile', leaseId: 'lease', revision: 2 };
export const endpoint: TileEndpoint = { protocolVersion: 'loom.wall.v1', endpointId: 'tile', deviceId: 'device', outputId: 'display',
    pixelSize: { width: 800, height: 600 }, renderModes: ['image', 'surface_v1'], inputCapabilities: ['pointer', 'keyboard'] };
export const layout: WallLayout = { protocolVersion: 'loom.wall.v1', wallId: 'wall', revision: 2,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    tiles: [{ tileId: 'tile', endpointId: 'tile', rect: { x: 0, y: 0, width: 800, height: 600 }, rotation: 'deg0' }],
    placements: [{ placementId: 'art', source: { kind: 'surface', id: 'instance' }, rect: { x: 0, y: 0, width: 800, height: 600 },
        sourceCrop: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 0, interactive: true }] };
export function surfaceState(nextBinding = binding, attachmentId = 'attachment'): TileSurfaceState {
    return { view: { binding: { ...nextBinding }, instanceId: 'instance', attachmentId }, width: 640, height: 480, generation: 0, sequence: 0,
        snapshot: { protocolVersion: 'loom.surface.v1', instanceId: 'instance', attachmentId, artId: 'counter', artVersion: '1.0.0',
            runtime: 'declarative', revision: 1, authoritativeState: { count: 7 }, resources: [], resourceLeases: [],
            scene: { id: 'root', type: 'column', children: [{ id: 'button', type: 'button', props: { label: 'Add' }, events: { click: 'add' } }] } },
        preview: null, result: null, confirmations: [], pending: [], failure: null };
}
export function surfaceWire() { return { protocolVersion: 'loom.wall.v1', ...surfaceState() }; }
