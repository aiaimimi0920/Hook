import { describe, expect, it } from 'vitest';
import { refreshTileSurfaceEvent } from '../../src/services/tileSurfaceEvent';
import type { SurfaceEvent } from '../../src/services/surfaceProtocol';
import { surfaceState } from '../fixtures/wall/surface';

const event: SurfaceEvent = { protocolVersion: 'loom.surface.v1', instanceId: 'instance', attachmentId: 'attachment',
    eventId: 'typed', nodeId: 'button', event: 'input', action: 'edit', class: 'continuous', generation: 0,
    baseRevision: 1, payload: { value: 'latest user text' } };

describe('Art input refresh', () => {
    it('preserves a queued absolute edit after an earlier edit updates the displayed value', () => {
        const previous = surfaceState().snapshot, current = surfaceState().snapshot;
        previous.scene.children![0] = { id: 'button', type: 'input', props: { value: 'old' }, events: { input: 'edit' } };
        current.scene.children![0] = { id: 'button', type: 'input', props: { value: 'earlier edit' }, events: { input: 'edit' } };
        current.revision = 2;
        expect(refreshTileSurfaceEvent(event, previous, current)).toEqual({ ...event, baseRevision: 2 });
        current.scene.children![0].props = { value: 'earlier edit', disabled: true };
        expect(() => refreshTileSurfaceEvent(event, previous, current)).toThrow('event_changed');
    });

    it('rejects another attachment and controls whose action or layout changed', () => {
        const previous = surfaceState().snapshot, current = surfaceState().snapshot;
        const click = { ...event, event: 'click', action: 'add', class: 'discrete' as const, payload: {} };
        current.revision = 2;
        current.scene.children![0].layout = { x: 200 };
        expect(() => refreshTileSurfaceEvent(click, previous, current)).toThrow('event_changed');
        current.attachmentId = 'replacement';
        expect(() => refreshTileSurfaceEvent(click, previous, current)).toThrow('event_changed');
    });
});
