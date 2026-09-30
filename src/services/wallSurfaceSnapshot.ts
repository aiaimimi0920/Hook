/** Bounded declarative scenes are the only executable presentation accepted by a tile. */
import { DECLARATIVE_SURFACE_NODE_TYPES, SURFACE_PROTOCOL_VERSION, isSafeSurfaceIdentifier,
    type SurfaceNode, type SurfaceResourceDescriptor, type SurfaceSnapshot } from './surfaceProtocol';

export function requireSurface(condition: boolean): asserts condition {
    if (!condition) throw new Error('wall_surface_response_invalid');
}
export function surfaceObject(value: unknown): Record<string, unknown> {
    requireSurface(typeof value === 'object' && value !== null && !Array.isArray(value));
    return value as Record<string, unknown>;
}
export function surfaceId(value: unknown): string {
    requireSurface(typeof value === 'string' && isSafeSurfaceIdentifier(value)); return value;
}
export function surfaceInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER, minimum = 0): number {
    requireSurface(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum); return value;
}
export function surfaceList(value: unknown, maximum: number): unknown[] {
    requireSurface(Array.isArray(value) && value.length <= maximum); return value;
}
export function boundedSurfaceJson(value: unknown): void {
    const stack = [{ value, depth: 0 }];
    let nodes = 0, characters = 0;
    while (stack.length) {
        const current = stack.pop()!;
        requireSurface(++nodes <= 32_768 && current.depth <= 32);
        if (typeof current.value === 'string') characters += current.value.length;
        else if (typeof current.value === 'number') requireSurface(Number.isFinite(current.value));
        else if (current.value && typeof current.value === 'object') {
            const entries = Object.entries(current.value);
            requireSurface(entries.length + stack.length <= 32_768);
            for (const [key, child] of entries) {
                characters += key.length; stack.push({ value: child, depth: current.depth + 1 });
            }
        } else requireSurface(current.value === null || typeof current.value === 'boolean' || current.value === undefined);
        requireSurface(characters <= 2 * 1024 * 1024);
    }
}

export function surfaceResource(value: unknown): SurfaceResourceDescriptor {
    const r = surfaceObject(value);
    const kind = (['image', 'audio', 'video', 'file', 'binary'] as const).find((item) => item === r.kind);
    requireSurface(kind !== undefined && typeof r.mime === 'string' && r.mime.length <= 128);
    const resourceId = surfaceId(r.resourceId);
    requireSurface(/^sha256:[0-9a-f]{64}$/.test(resourceId));
    return { resourceId, kind, mime: r.mime, size: surfaceInteger(r.size),
        width: r.width == null ? undefined : surfaceInteger(r.width, 16384, 1),
        height: r.height == null ? undefined : surfaceInteger(r.height, 16384, 1) };
}

export function parseWallSurfaceSnapshot(value: unknown, instanceId: string, attachmentId: string): SurfaceSnapshot {
    const s = surfaceObject(value);
    requireSurface(s.protocolVersion === SURFACE_PROTOCOL_VERSION && s.instanceId === instanceId
        && s.attachmentId === attachmentId && s.runtime === 'declarative');
    requireSurface(surfaceList(s.resourceLeases ?? [], 0).length === 0);
    const seen = new Set<string>();
    function node(value: unknown, depth: number): SurfaceNode {
        const n = surfaceObject(value), id = surfaceId(n.id);
        requireSurface(depth <= 16 && seen.size < 512 && !seen.has(id)); seen.add(id);
        const type = DECLARATIVE_SURFACE_NODE_TYPES.find((type) => type === n.type);
        requireSurface(type !== undefined);
        const events = Object.entries(surfaceObject(n.events ?? {}));
        requireSurface(events.length <= 16);
        return { id, type, props: n.props, layout: n.layout, style: n.style, accessibility: n.accessibility,
            events: Object.fromEntries(events.map(([event, action]) => [surfaceId(event), surfaceId(action)])),
            children: surfaceList(n.children ?? [], 512).map((child) => node(child, depth + 1)) };
    }
    return { protocolVersion: SURFACE_PROTOCOL_VERSION, instanceId, attachmentId,
        artId: surfaceId(s.artId), artVersion: surfaceId(s.artVersion), revision: surfaceInteger(s.revision),
        runtime: 'declarative', viewId: s.viewId == null ? undefined : surfaceId(s.viewId),
        scene: node(s.scene, 0), authoritativeState: s.authoritativeState,
        resources: surfaceList(s.resources ?? [], 64).map(surfaceResource), resourceLeases: [] };
}
