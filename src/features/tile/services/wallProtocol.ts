/** Strict, bounded wire parsing creates immutable snapshots for rendering and input. */
import {
    WALL_MAX_COORDINATE, WALL_MIN_EXTENT, WALL_PROTOCOL_VERSION,
    type TileEndpoint, type WallLayout, type WallPlacement, type WallRect, type WallTile,
    type WallEndpointStatus, type WallPresenterLease, type WallStateSnapshot,
    type WallPresentation, type WallPresentationReport, type TileDisplayInfo, type WallIdentification,
    type WallTiming, type WallSceneReport,
} from './wallTypes';

function requireWall(condition: boolean, field: string): asserts condition {
    if (!condition) throw new Error(`Invalid wall contract: ${field}`);
}

function record(value: unknown, keys: readonly string[], field: string, optional: readonly string[] = []): Record<string, unknown> {
    requireWall(typeof value === 'object' && value !== null && !Array.isArray(value), field);
    const result = value as Record<string, unknown>;
    requireWall(Object.keys(result).every((key) => keys.includes(key) || optional.includes(key))
        && keys.every((key) => Object.hasOwn(result, key)), field);
    return result;
}

function id(value: unknown): string {
    requireWall(typeof value === 'string' && value.length > 0 && value.length <= 160
        && /^[A-Za-z0-9_.:/-]+$/.test(value), 'identity');
    return value;
}

function finite(value: unknown, min: number, max: number, field: string): number {
    requireWall(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, field);
    return value;
}

function integer(value: unknown, min: number, max: number, field: string): number {
    const result = finite(value, min, max, field);
    requireWall(Number.isSafeInteger(result), field);
    return result;
}

function choice<T extends string>(value: unknown, choices: readonly T[], field: string): T {
    const result = choices.find((candidate) => candidate === value);
    requireWall(result !== undefined, field);
    return result;
}

function boundedList(value: unknown, max: number, field: string): unknown[] {
    requireWall(Array.isArray(value) && value.length <= max, field);
    return value;
}

function choices<T extends string>(value: unknown, options: readonly T[], field: string): readonly T[] {
    const result = boundedList(value, options.length, field).map((entry) => choice(entry, options, field));
    requireWall(new Set(result).size === result.length, field);
    return Object.freeze(result);
}

function rect(value: unknown): WallRect {
    const r = record(value, ['x', 'y', 'width', 'height'], 'rect');
    const x = finite(r.x, -WALL_MAX_COORDINATE, WALL_MAX_COORDINATE, 'rect.x');
    const y = finite(r.y, -WALL_MAX_COORDINATE, WALL_MAX_COORDINATE, 'rect.y');
    const width = finite(r.width, WALL_MIN_EXTENT, WALL_MAX_COORDINATE, 'rect.width');
    const height = finite(r.height, WALL_MIN_EXTENT, WALL_MAX_COORDINATE, 'rect.height');
    requireWall(x + width <= WALL_MAX_COORDINATE && y + height <= WALL_MAX_COORDINATE
        && x + width > x && y + height > y, 'rect extent');
    return Object.freeze({ x, y, width, height });
}

function containsRect(outer: WallRect, inner: WallRect): boolean {
    return inner.x >= outer.x && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width
        && inner.y + inner.height <= outer.y + outer.height;
}

function intersects(a: WallRect, b: WallRect): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width
        && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function parseTileEndpoint(value: unknown): TileEndpoint {
    const e = record(value, ['protocolVersion', 'endpointId', 'deviceId', 'outputId', 'pixelSize', 'renderModes', 'inputCapabilities'], 'endpoint', ['display', 'scheduledPresentation']);
    requireWall(!Object.hasOwn(e, 'scheduledPresentation') || typeof e.scheduledPresentation === 'boolean', 'scheduledPresentation');
    requireWall(e.protocolVersion === WALL_PROTOCOL_VERSION, 'protocolVersion');
    const size = record(e.pixelSize, ['width', 'height'], 'pixelSize');
    const renderModes = choices(e.renderModes, ['raw_bgra', 'h264', 'image', 'surface_v1'] as const, 'renderModes');
    requireWall(renderModes.length > 0, 'renderModes');
    let display: TileDisplayInfo | undefined;
    if (Object.hasOwn(e, 'display')) {
        const d = record(e.display, ['name', 'canIdentify'], 'display');
        requireWall(typeof d.name === 'string' && d.name.trim().length > 0 && Array.from(d.name).length <= 256
            && !Array.from(d.name).some((c) => c.charCodeAt(0) <= 31 || c === '\x7f') && typeof d.canIdentify === 'boolean', 'display');
        display = Object.freeze({ name: d.name, canIdentify: d.canIdentify });
    }
    return Object.freeze({
        protocolVersion: WALL_PROTOCOL_VERSION, endpointId: id(e.endpointId),
        deviceId: id(e.deviceId), outputId: id(e.outputId),
        pixelSize: Object.freeze({
            width: integer(size.width, 1, 16_384, 'pixelSize.width'),
            height: integer(size.height, 1, 16_384, 'pixelSize.height'),
        }),
        renderModes,
        inputCapabilities: choices(e.inputCapabilities, ['pointer', 'wheel', 'keyboard', 'text', 'touch', 'pen'] as const, 'inputCapabilities'),
        ...(display ? { display } : {}),
        ...(Object.hasOwn(e, 'scheduledPresentation') ? { scheduledPresentation: e.scheduledPresentation as boolean } : {}),
    });
}

function tile(value: unknown): WallTile {
    const t = record(value, ['tileId', 'endpointId', 'rect', 'rotation'], 'tile');
    return Object.freeze({
        tileId: id(t.tileId), endpointId: id(t.endpointId), rect: rect(t.rect),
        rotation: choice(t.rotation, ['deg0', 'deg90', 'deg180', 'deg270'] as const, 'rotation'),
    });
}

function placement(value: unknown): WallPlacement {
    const p = record(value, ['placementId', 'source', 'rect', 'sourceCrop', 'zIndex', 'interactive'], 'placement');
    const source = record(p.source, ['kind', 'id'], 'source');
    const kind = choice(source.kind, ['live', 'image', 'surface'] as const, 'source.kind');
    const sourceId = id(source.id);
    requireWall(kind !== 'image' || /^sha256:[0-9a-f]{64}$/.test(sourceId), 'source.id');
    requireWall(typeof p.interactive === 'boolean' && (kind !== 'image' || !p.interactive), 'interactive');
    const sourceCrop = rect(p.sourceCrop);
    requireWall(containsRect({ x: 0, y: 0, width: 1, height: 1 }, sourceCrop), 'sourceCrop');
    return Object.freeze({
        placementId: id(p.placementId), source: Object.freeze({ kind, id: sourceId }),
        rect: rect(p.rect), sourceCrop,
        zIndex: integer(p.zIndex, -2_147_483_648, 2_147_483_647, 'zIndex'),
        interactive: p.interactive,
    });
}

export function parseWallLayout(value: unknown): WallLayout {
    const l = record(value, ['protocolVersion', 'wallId', 'revision', 'bounds', 'tiles', 'placements'], 'layout');
    requireWall(l.protocolVersion === WALL_PROTOCOL_VERSION, 'protocolVersion');
    const bounds = rect(l.bounds);
    const tiles = boundedList(l.tiles, 64, 'tiles').map(tile);
    const placements = boundedList(l.placements, 256, 'placements').map(placement);
    requireWall(new Set(tiles.map((t) => t.tileId)).size === tiles.length, 'duplicate tileId');
    requireWall(new Set(tiles.map((t) => t.endpointId)).size === tiles.length, 'duplicate endpointId');
    requireWall(new Set(placements.map((p) => p.placementId)).size === placements.length, 'duplicate placementId');
    for (let index = 0; index < tiles.length; index += 1) {
        const current = tiles[index];
        requireWall(containsRect(bounds, current.rect), 'tile outside wall');
        requireWall(!tiles.slice(0, index).some((prior) => intersects(prior.rect, current.rect)), 'overlapping tiles');
    }
    return Object.freeze({
        protocolVersion: WALL_PROTOCOL_VERSION, wallId: id(l.wallId),
        revision: integer(l.revision, 1, Number.MAX_SAFE_INTEGER, 'revision'), bounds,
        tiles: Object.freeze(tiles), placements: Object.freeze(placements),
    });
}

export function parseWallClientResponse(value: unknown): Readonly<{ deviceId: string; body: unknown }> {
    const response = record(value, ['deviceId', 'body'], 'native response');
    return Object.freeze({ deviceId: id(response.deviceId), body: response.body });
}

export function parseWallControlGrant(value: unknown) {
    const grant = record(value, ['protocolVersion', 'controlId', 'endpointId', 'revision', 'placementId', 'sessionId', 'leaseTtlMs'], 'control grant');
    requireWall(grant.protocolVersion === WALL_PROTOCOL_VERSION, 'protocolVersion');
    return Object.freeze({ protocolVersion: WALL_PROTOCOL_VERSION, controlId: id(grant.controlId), endpointId: id(grant.endpointId),
        placementId: id(grant.placementId), sessionId: id(grant.sessionId),
        revision: integer(grant.revision, 1, Number.MAX_SAFE_INTEGER, 'revision'),
        leaseTtlMs: integer(grant.leaseTtlMs, 1000, 10000, 'leaseTtlMs') });
}

export function parseWallState(value: unknown): WallStateSnapshot {
    const state = record(value, ['protocolVersion', 'revision', 'endpoints', 'layouts'], 'state', ['presentations', 'timing']);
    requireWall(state.protocolVersion === WALL_PROTOCOL_VERSION, 'protocolVersion');
    const revision = integer(state.revision, 0, Number.MAX_SAFE_INTEGER, 'revision');
    const layouts = boundedList(state.layouts, 64, 'layouts').map(parseWallLayout);
    requireWall(new Set(layouts.map((l) => l.wallId)).size === layouts.length, 'duplicate wallId');
    requireWall(layouts.every((l) => l.revision <= revision), 'future layout revision');
    const assigned = layouts.flatMap((l) => l.tiles.map((t) => t.endpointId));
    requireWall(new Set(assigned).size === assigned.length, 'endpoint assigned to multiple walls');
    const timing = Object.hasOwn(state, 'timing') ? parseWallTiming(state.timing, layouts) : undefined;
    const presentations: WallPresentation[] = (Object.hasOwn(state, 'presentations') ? boundedList(state.presentations, 64, 'presentations') : []).map((entry) => {
        const control = record(entry, ['wallId', 'revision', 'mode'], 'presentation');
        const wallId = id(control.wallId);
        requireWall(layouts.some((layout) => layout.wallId === wallId), 'presentation wall');
        return Object.freeze({ wallId, revision: integer(control.revision, 1, revision, 'presentation revision'),
            mode: choice(control.mode, ['frozen', 'black'] as const, 'presentation mode') });
    });
    requireWall(new Set(presentations.map((p) => p.wallId)).size === presentations.length, 'duplicate presentation');
    const endpoints: WallEndpointStatus[] = boundedList(state.endpoints, 256, 'endpoints').map((entry) => {
        const status = record(entry, ['endpoint', 'online', 'appliedRevision'], 'endpoint status', ['presentation', 'identification', 'scene']);
        const endpoint = parseTileEndpoint(status.endpoint);
        requireWall(typeof status.online === 'boolean', 'online');
        const appliedRevision = status.appliedRevision === null ? null
            : integer(status.appliedRevision, 1, revision, 'appliedRevision');
        const layout = layouts.find((l) => l.tiles.some((t) => t.endpointId === endpoint.endpointId));
        requireWall(appliedRevision === null || (status.online && appliedRevision === layout?.revision), 'applied layout');
        const scene = Object.hasOwn(status, 'scene') ? parseWallSceneReport(status.scene, layout?.revision, appliedRevision) : undefined;
        requireWall(!scene || (status.online && timing !== undefined), 'scene authority');
        let presentation: WallPresentationReport | undefined;
        if (Object.hasOwn(status, 'presentation')) {
            const report = record(status.presentation, ['revision', 'outcome'], 'presentation report');
            const control = presentations.find((p) => p.wallId === layout?.wallId);
            const outcome = choice(report.outcome, ['applied', 'frame_unavailable'] as const, 'presentation outcome');
            requireWall(status.online && control !== undefined && report.revision === control.revision, 'presentation report revision');
            requireWall(control.mode === 'frozen' ? outcome === 'applied' ? appliedRevision === layout?.revision : appliedRevision === null
                : outcome === 'applied' && appliedRevision === null, 'presentation report outcome');
            presentation = Object.freeze({ revision: control.revision, outcome });
        }
        let identification: WallIdentification | undefined;
        if (Object.hasOwn(status, 'identification')) {
            const value = record(status.identification, ['requestId', 'remainingMs', 'applied'], 'identification');
            requireWall(status.online && endpoint.display?.canIdentify === true && typeof value.applied === 'boolean'
                && !presentations.some((p) => p.wallId === layout?.wallId), 'identification authority');
            identification = Object.freeze({ requestId: id(value.requestId),
                remainingMs: integer(value.remainingMs, 1, 10_000, 'identification remainingMs'), applied: value.applied });
        }
        return Object.freeze({ endpoint, online: status.online, appliedRevision, ...(presentation ? { presentation } : {}),
            ...(identification ? { identification } : {}), ...(scene ? { scene } : {}) });
    });
    requireWall(new Set(endpoints.map((e) => e.endpoint.endpointId)).size === endpoints.length, 'duplicate endpoint');
    requireWall(new Set(endpoints.map((e) => `${e.endpoint.deviceId}\n${e.endpoint.outputId}`)).size === endpoints.length, 'duplicate output');
    requireWall(revision > 0 || (endpoints.length === 0 && layouts.length === 0), 'initial state');
    return Object.freeze({ protocolVersion: WALL_PROTOCOL_VERSION, revision,
        endpoints: Object.freeze(endpoints), layouts: Object.freeze(layouts),
        ...(timing ? { timing } : {}),
        ...(Object.hasOwn(state, 'presentations') ? { presentations: Object.freeze(presentations) } : {}) });
}

function parseWallTiming(value: unknown, layouts: readonly WallLayout[]): WallTiming {
    const timing = record(value, ['clockId', 'serverTimeMs', 'scenes'], 'timing');
    const serverTimeMs = integer(timing.serverTimeMs, 1, Number.MAX_SAFE_INTEGER, 'server time');
    const scenes = boundedList(timing.scenes, 64, 'scenes').map((value) => {
        const scene = record(value, ['wallId', 'revision', 'preparedAtMs', 'activateAtMs'], 'scene');
        const wallId = id(scene.wallId), layout = layouts.find((layout) => layout.wallId === wallId);
        requireWall(layout !== undefined && scene.revision === layout.revision, 'scene layout revision');
        const preparedAtMs = integer(scene.preparedAtMs, 1, serverTimeMs, 'scene prepared time');
        return Object.freeze({ wallId, revision: layout.revision, preparedAtMs,
            activateAtMs: integer(scene.activateAtMs, preparedAtMs, preparedAtMs + 10_000, 'scene activation') });
    });
    requireWall(new Set(scenes.map((scene) => scene.wallId)).size === scenes.length && scenes.length === layouts.length, 'scene coverage');
    return Object.freeze({ clockId: id(timing.clockId), serverTimeMs, scenes: Object.freeze(scenes) });
}

function parseWallSceneReport(value: unknown, revision: number | undefined, applied: number | null): WallSceneReport {
    const report = record(value, ['revision', 'prepared', 'appliedAtMs', 'clockUncertaintyMs'], 'scene report');
    requireWall(revision !== undefined && report.revision === revision && typeof report.prepared === 'boolean', 'scene report revision');
    const appliedAtMs = report.appliedAtMs === null ? null : integer(report.appliedAtMs, 1, Number.MAX_SAFE_INTEGER, 'scene applied time');
    const clockUncertaintyMs = report.clockUncertaintyMs === null ? null : integer(report.clockUncertaintyMs, 0, 1000, 'clock uncertainty');
    requireWall((appliedAtMs !== null) === (applied !== null) && (applied === null || (report.prepared && clockUncertaintyMs !== null)), 'scene report outcome');
    return Object.freeze({ revision, prepared: report.prepared, appliedAtMs, clockUncertaintyMs });
}

export function parseWallPresenterLease(value: unknown): WallPresenterLease {
    const lease = record(value, ['protocolVersion', 'leaseId', 'leaseTtlMs'], 'lease');
    requireWall(lease.protocolVersion === WALL_PROTOCOL_VERSION, 'protocolVersion');
    return Object.freeze({ protocolVersion: WALL_PROTOCOL_VERSION, leaseId: id(lease.leaseId),
        leaseTtlMs: integer(lease.leaseTtlMs, 1, 60_000, 'leaseTtlMs') });
}

export function parseWallAccepted(value: unknown): void {
    const result = record(value, ['protocolVersion', 'accepted'], 'acknowledgement');
    requireWall(result.protocolVersion === WALL_PROTOCOL_VERSION && result.accepted === true, 'acknowledgement');
}
