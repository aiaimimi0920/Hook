import { createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';

/** An asynchronous host edit owns its local draft until the host has read its outcome. */
export function createSurfaceInputDraft(identity: () => string, source: () => string, changed: (value: string) => void) {
    const scope = createMemo(identity), authoritative = createMemo(source);
    const [value, setValue] = createSignal(untrack(authoritative));
    let currentScope = untrack(scope), epoch = 0, pending = 0;
    function apply(next: string) { setValue(next); untrack(() => changed(next)); }
    createEffect(() => {
        const nextScope = scope(), next = authoritative();
        if (nextScope !== currentScope) { currentScope = nextScope; epoch++; pending = 0; }
        if (!pending) apply(next);
    });
    onCleanup(() => { epoch++; });
    return {
        value,
        dispatch(next: string, emit: () => unknown) {
            apply(next);
            const request = emit();
            if (!request || typeof request !== 'object' || !('then' in request) || typeof request.then !== 'function') return;
            const ticket = epoch;
            pending++;
            const settle = () => {
                if (ticket !== epoch) return;
                if (--pending === 0) apply(authoritative());
            };
            void Promise.resolve(request).then(settle, settle);
        },
    };
}
