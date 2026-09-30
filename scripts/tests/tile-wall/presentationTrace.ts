import type { Page, Request } from 'playwright';

/** Bounded timing observations for the owned terminal; never record credentials or request bodies. */
export async function tracePresentation(page: Page) {
    const start = Date.now(), rows: unknown[] = [];
    const record = (row: Record<string, unknown>) => {
        if (rows.length === 1024) rows.shift();
        rows.push({ ms: Date.now() - start, ...row });
    };
    const pending = new Map<Request, { kind: string; node?: string; sent: number }>();
    const sent = (request: Request) => {
        if (!request.url().includes('ipc.localhost') || pending.size >= 64) return;
        let kind = new URL(request.url()).pathname;
        let node: string | undefined;
        try {
            const data = request.postDataJSON() as { operation?: { kind?: string; appliedRevision?: number | null;
                presentation?: { revision: number; outcome: string }; request?: { event?: { nodeId?: string; event?: string } } } };
            kind = data?.operation?.kind ?? kind;
            node = data?.operation?.request?.event?.nodeId;
            if (kind === 'heartbeat') record({ kind, phase: 'report', appliedRevision: data.operation?.appliedRevision,
                presentation: data.operation?.presentation });
            if (kind === 'surface_event') record({ kind, phase: 'event', node, event: data.operation?.request?.event?.event });
        } catch { /* Record only the command path for non-JSON native messages. */ }
        pending.set(request, { kind, node, sent: Date.now() });
        record({ kind, node, phase: 'sent' });
    };
    const received = async (request: Request) => {
        const entry = pending.get(request); pending.delete(request);
        if (!entry) return;
        const response = await request.response().catch(() => null);
        const failed = response && (response.status() >= 400 || response.headers()['tauri-response'] === 'error');
        const error: unknown = failed ? await response.json().catch(() => undefined) : undefined;
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
        record({ kind: entry.kind, node: entry.node, phase: request.failure() || failed ? 'failed' : 'received',
            elapsedMs: Date.now() - entry.sent,
            ...(typeof code === 'string' && /^[a-z][a-z0-9_]{0,95}$/.test(code) ? { code } : {}),
            ...(typeof status === 'number' ? { status } : {}) });
    };
    page.on('request', sent); page.on('requestfinished', received); page.on('requestfailed', received);
    await page.evaluate(() => {
        const scope = window as unknown as {
            __presentationTrace?: { stop: () => unknown[] };
        };
        if (scope.__presentationTrace) throw new Error('Presentation trace already active');
        const rows: unknown[] = [], start = Date.now();
        const record = (row: Record<string, unknown>) => {
            if (rows.length === 512) rows.shift();
            rows.push({ ms: Date.now() - start, ...row });
        };
        let previous = '';
        const observe = () => {
            const state = { notices: [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent?.slice(0, 256)),
                busy: document.querySelector('[aria-busy]')?.getAttribute('aria-busy'),
                surfaces: document.querySelectorAll('.declarative-surface').length };
            const next = JSON.stringify(state);
            if (next !== previous) { previous = next; record({ kind: 'state', ...state }); }
        };
        const observer = new MutationObserver(observe);
        observer.observe(document.body, { subtree: true, childList: true, characterData: true,
            attributes: true, attributeFilter: ['aria-busy'] });
        observe();
        const dom = (event: Event) => {
            const node = event.target instanceof HTMLElement ? event.target : undefined;
            if (node?.dataset.surfaceNodeId) record({ kind: event.type, node: node.dataset.surfaceNodeId,
                revision: node.closest<HTMLElement>('.declarative-surface')?.dataset.surfaceRevision });
        };
        for (const name of ['input', 'change', 'click']) document.addEventListener(name, dom, true);
        scope.__presentationTrace = { stop: () => {
            observer.disconnect();
            for (const name of ['input', 'change', 'click']) document.removeEventListener(name, dom, true);
            delete scope.__presentationTrace; return rows;
        } };
    });
    return async () => {
        page.off('request', sent); page.off('requestfinished', received); page.off('requestfailed', received); pending.clear();
        const dom = await page.evaluate(() => (window as unknown as { __presentationTrace?: { stop: () => unknown[] } }).__presentationTrace?.stop() ?? []);
        return { requests: rows, dom };
    };
}
