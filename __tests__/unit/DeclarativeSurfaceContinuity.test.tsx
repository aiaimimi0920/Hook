// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { DeclarativeSurface } from '../../src/components/DeclarativeSurface';
import type { SurfaceEvent, SurfaceSnapshot } from '../../src/services/surfaceProtocol';

const snapshot = (type: 'input' | 'textarea', revision = 1, value = 'saved'): SurfaceSnapshot => ({
    protocolVersion: 'loom.surface.v1', instanceId: 'form', attachmentId: 'view', artId: 'form', artVersion: '1.0.0', revision,
    scene: { id: 'root', type: 'column', children: [
        { id: 'field', type, props: { value }, events: { input: 'edit', change: 'commit' } },
        { id: 'status', type: 'text', props: { text: `revision ${revision}` } },
    ] },
});

afterEach(() => { document.body.innerHTML = ''; });

describe('declarative input continuity across authoritative snapshots', () => {
    it.each(['input', 'textarea'] as const)('keeps %s focus, selection and draft when a sibling changes', (type) => {
        const host = document.createElement('div'); document.body.append(host);
        const [current, update] = createSignal(snapshot(type));
        const events: SurfaceEvent[] = [];
        const dispose = render(() => <DeclarativeSurface unitId="form" snapshot={current()} generation={0}
            onEvent={(event) => events.push(event)} />, host);
        try {
            const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(type)!;
            input.focus(); input.value = 'unacknowledged draft';
            input.dispatchEvent(new InputEvent('input', { bubbles: true })); input.setSelectionRange(4, 8);
            update(snapshot(type, 2));
            expect(host.querySelector(type)).toBe(input);
            expect(document.activeElement).toBe(input);
            expect(input.value).toBe('unacknowledged draft');
            expect([input.selectionStart, input.selectionEnd]).toEqual([4, 8]);
            input.dispatchEvent(new Event('change', { bubbles: true }));
            expect(events.at(-1)).toMatchObject({ baseRevision: 2, payload: { value: 'unacknowledged draft' } });
        } finally { dispose(); }
    });

    it.each(['input', 'textarea'] as const)('still applies a changed authoritative %s value', (type) => {
        const host = document.createElement('div'); document.body.append(host);
        const [current, update] = createSignal(snapshot(type));
        const dispose = render(() => <DeclarativeSurface unitId="form" snapshot={current()} generation={0} onEvent={() => {}} />, host);
        try {
            const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(type)!;
            input.value = 'local draft'; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            update(snapshot(type, 2, 'canonical'));
            expect(host.querySelector(type)?.value).toBe('canonical');
        } finally { dispose(); }
    });

    it.each(['input', 'textarea'] as const)('keeps the newest %s draft until pending edits settle', async (type) => {
        const host = document.createElement('div'); document.body.append(host);
        const [current, update] = createSignal(snapshot(type));
        const finish: (() => void)[] = [];
        const dispose = render(() => <DeclarativeSurface unitId="form" snapshot={current()} generation={0}
            onEvent={() => new Promise<void>((resolve) => finish.push(resolve))} />, host);
        try {
            const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(type)!;
            input.focus();
            for (const value of ['first', 'newest draft']) {
                input.value = value; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            }
            update(snapshot(type, 2, 'first'));
            expect(input.value).toBe('newest draft');
            finish[0](); await Promise.resolve();
            expect(input.value).toBe('newest draft');
            update(snapshot(type, 3, 'canonical'));
            expect(input.value).toBe('newest draft');
            finish[1](); await Promise.resolve();
            expect(input.value).toBe('canonical');
            input.value = 'abandoned draft'; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            update({ ...snapshot(type, 1, 'replacement'), attachmentId: 'replacement-view' });
            expect(input.value).toBe('replacement');
            finish[2](); await Promise.resolve();
            expect(input.value).toBe('replacement');
        } finally { dispose(); }
    });
});
