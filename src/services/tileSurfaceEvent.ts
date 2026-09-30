/** Refresh only an unchanged control binding; never redirect an old event to a replaced node. */
import type { SurfaceEvent, SurfaceNode, SurfaceSnapshot } from './surfaceProtocol';

function find(root: SurfaceNode, id: string): SurfaceNode | undefined {
    if (root.id === id) return root;
    for (const child of root.children ?? []) {
        const node = find(child, id);
        if (node) return node;
    }
}

function valueEdit(node: SurfaceNode | undefined, event: SurfaceEvent): boolean {
    if (!node || !['input', 'textarea', 'number', 'slider', 'switch', 'select'].includes(node.type)
        || !['input', 'change'].includes(event.event)) return false;
    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('value' in payload)) return false;
    return typeof payload.value === 'string' || typeof payload.value === 'boolean'
        || typeof payload.value === 'number' && Number.isFinite(payload.value);
}

export function isTileSurfaceValueEdit(event: SurfaceEvent, snapshot: SurfaceSnapshot): boolean {
    return valueEdit(find(snapshot.scene, event.nodeId), event);
}

function contract(node: SurfaceNode, event: SurfaceEvent): string {
    const props: Record<string, unknown> = node.props && typeof node.props === 'object' && !Array.isArray(node.props)
        ? { ...node.props as Record<string, unknown> } : {};
    // Absolute value edits retain user intent when an earlier edit changes the displayed value.
    if (valueEdit(node, event)) delete props.value;
    return JSON.stringify({ ...node, props });
}

export function refreshTileSurfaceEvent(event: SurfaceEvent, previous: SurfaceSnapshot, current: SurfaceSnapshot): SurfaceEvent {
    if (previous.revision !== event.baseRevision || previous.instanceId !== current.instanceId
        || previous.attachmentId !== current.attachmentId || current.revision < previous.revision) throw new Error('wall_surface_event_changed');
    if (current.revision === previous.revision) return event;
    const before = find(previous.scene, event.nodeId), after = find(current.scene, event.nodeId);
    if (!before || !after || after.events?.[event.event] !== event.action
        || contract(before, event) !== contract(after, event)) throw new Error('wall_surface_event_changed');
    return { ...event, baseRevision: current.revision };
}
