/** Public wall control types. Physical endpoints and content sessions are distinct. */
export const WALL_PROTOCOL_VERSION = 'loom.wall.v1';
export const WALL_MIN_EXTENT = 1 / 65_536;
export const WALL_MAX_COORDINATE = 1_000_000;

export interface WallPoint { readonly x: number; readonly y: number }
export interface TilePixelPoint { readonly x: number; readonly y: number }
export interface WallRect extends WallPoint { readonly width: number; readonly height: number }
export type TileRotation = 'deg0' | 'deg90' | 'deg180' | 'deg270';
export type TileRenderMode = 'raw_bgra' | 'h264' | 'image' | 'surface_v1';
export type TileInputCapability = 'pointer' | 'wheel' | 'keyboard' | 'text' | 'touch' | 'pen';
export interface TileDisplayInfo { readonly name: string; readonly canIdentify: boolean }
export interface WallIdentification { readonly requestId: string; readonly remainingMs: number; readonly applied: boolean }

export interface TileEndpoint {
    readonly protocolVersion: typeof WALL_PROTOCOL_VERSION;
    readonly endpointId: string;
    readonly deviceId: string;
    readonly outputId: string;
    readonly pixelSize: Readonly<{ width: number; height: number }>;
    readonly renderModes: readonly TileRenderMode[];
    readonly inputCapabilities: readonly TileInputCapability[];
    readonly display?: TileDisplayInfo;
    readonly scheduledPresentation?: boolean;
}

export interface WallTile {
    readonly tileId: string;
    readonly endpointId: string;
    readonly rect: WallRect;
    readonly rotation: TileRotation;
}

export interface WallContentSource {
    readonly kind: 'live' | 'image' | 'surface';
    readonly id: string;
}

export interface WallPlacement {
    readonly placementId: string;
    readonly source: WallContentSource;
    readonly rect: WallRect;
    readonly sourceCrop: WallRect;
    readonly zIndex: number;
    readonly interactive: boolean;
}

export interface WallLayout {
    readonly protocolVersion: typeof WALL_PROTOCOL_VERSION;
    readonly wallId: string;
    readonly revision: number;
    readonly bounds: WallRect;
    readonly tiles: readonly WallTile[];
    readonly placements: readonly WallPlacement[];
}

export interface WallHit {
    readonly placementId: string;
    readonly source: WallContentSource;
    readonly sourcePoint: WallPoint;
}

export interface WallProjection {
    readonly placementId: string;
    readonly visibleWallRect: WallRect;
    readonly sourceCrop: WallRect;
    readonly outputQuad: readonly [WallPoint, WallPoint, WallPoint, WallPoint];
}

export interface WallEndpointStatus {
    readonly endpoint: TileEndpoint;
    readonly online: boolean;
    readonly appliedRevision: number | null;
    readonly presentation?: WallPresentationReport;
    readonly identification?: WallIdentification;
    readonly scene?: WallSceneReport;
}

export interface WallScene {
    readonly wallId: string;
    readonly revision: number;
    readonly preparedAtMs: number;
    readonly activateAtMs: number;
}
export interface WallTiming {
    readonly clockId: string;
    readonly serverTimeMs: number;
    readonly scenes: readonly WallScene[];
}
export interface WallSceneReport {
    readonly revision: number;
    readonly prepared: boolean;
    readonly appliedAtMs: number | null;
    readonly clockUncertaintyMs: number | null;
}

export interface WallPresentation {
    readonly wallId: string;
    readonly revision: number;
    readonly mode: 'frozen' | 'black';
}

export interface WallPresentationReport {
    readonly revision: number;
    readonly outcome: 'applied' | 'frame_unavailable';
}

export interface WallStateSnapshot {
    readonly protocolVersion: typeof WALL_PROTOCOL_VERSION;
    readonly revision: number;
    readonly endpoints: readonly WallEndpointStatus[];
    readonly layouts: readonly WallLayout[];
    readonly presentations?: readonly WallPresentation[];
    readonly timing?: WallTiming;
}

export interface WallPresenterLease {
    readonly protocolVersion: typeof WALL_PROTOCOL_VERSION;
    readonly leaseId: string;
    readonly leaseTtlMs: number;
}
