import type { Page, Request } from 'playwright';

/** Observe one input exercise without media traffic or credential-bearing request bodies. */
export async function traceNativeInput(page: Page) {
    const start = Date.now(), requests: unknown[] = [];
    const pending = new Map<Request, { kind: string; sent: number }>();
    let stopped = false;
    const record = (row: Record<string, unknown>) => {
        if (stopped) return;
        if (requests.length === 256) requests.shift();
        requests.push({ ms: Date.now() - start, ...row });
    };
    const sent = (request: Request) => {
        if (!request.url().includes('ipc.localhost') || pending.size >= 64) return;
        try {
            const data = request.postDataJSON() as { operation?: { kind?: string; request?: {
                sequence?: number; event?: { kind?: string; pixel?: { x: number; y: number }; deltaX?: number; deltaY?: number };
            } } };
            const kind = data.operation?.kind;
            if (!kind || !['input', 'control_acquire', 'control_renew', 'control_release'].includes(kind)) return;
            const input = data.operation?.request;
            pending.set(request, { kind, sent: Date.now() });
            record({ phase: 'sent', kind, sequence: input?.sequence, event: input?.event?.kind,
                pixel: input?.event?.pixel, deltaX: input?.event?.deltaX, deltaY: input?.event?.deltaY });
        } catch { /* Non-JSON native messages are outside this observation. */ }
    };
    const received = async (request: Request) => {
        const entry = pending.get(request); pending.delete(request);
        if (!entry) return;
        const response = await request.response().catch(() => null);
        const failed = response && (response.status() >= 400 || response.headers()['tauri-response'] === 'error');
        const error: unknown = failed ? await response.json().catch(() => undefined) : undefined;
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
        record({ kind: entry.kind, phase: request.failure() || failed ? 'failed' : 'received',
            elapsedMs: Date.now() - entry.sent,
            ...(typeof code === 'string' && /^[a-z][a-z0-9_]{0,95}$/.test(code) ? { code } : {}),
            ...(typeof status === 'number' ? { status } : {}) });
    };
    await page.evaluate(() => {
        const scope = window as unknown as { __nativeInputTrace?: { stop: () => unknown[] } };
        if (scope.__nativeInputTrace) throw new Error('Native input trace already active');
        const rows: unknown[] = [], start = Date.now();
        const names = ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup', 'blur', 'focus'];
        const observe = (event: Event) => {
            if (rows.length === 256) rows.shift();
            rows.push({ ms: Date.now() - start, type: event.type, focus: document.hasFocus(),
                target: event.target instanceof Element ? event.target.tagName : 'window',
                ...(event instanceof MouseEvent ? { x: event.clientX, y: event.clientY, buttons: event.buttons,
                    ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey } : {}),
                ...(event instanceof WheelEvent ? { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode } : {}) });
        };
        names.forEach((name) => window.addEventListener(name, observe, true));
        scope.__nativeInputTrace = { stop: () => {
            names.forEach((name) => window.removeEventListener(name, observe, true));
            delete scope.__nativeInputTrace; return rows;
        } };
    });
    page.on('request', sent); page.on('requestfinished', received); page.on('requestfailed', received);
    return async () => {
        page.off('request', sent); page.off('requestfinished', received); page.off('requestfailed', received);
        const dom = await page.evaluate(() => (window as unknown as {
            __nativeInputTrace?: { stop: () => unknown[] };
        }).__nativeInputTrace?.stop() ?? []).catch(() => null);
        const inFlight = pending.size; pending.clear(); stopped = true;
        return { requests, dom, inFlight };
    };
}
