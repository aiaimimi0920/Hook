import type { Page } from 'playwright';

/** Observe only the owned output DOM; credentials and native invocation remain untouched. */
export async function traceArtInput(page: Page) {
    await page.evaluate(() => {
        const scope = window as unknown as { __tileInputTrace?: { stop: () => unknown[] } };
        const rows: unknown[] = [], start = performance.now();
        const record = (value: Record<string, unknown>) => {
            if (rows.length < 512) rows.push({ ms: Math.round(performance.now() - start), ...value });
        };
        const dom = (event: Event) => {
            const node = event.target instanceof HTMLElement ? event.target : undefined;
            record({ kind: event.type, node: node?.dataset.surfaceNodeId,
                value: node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : undefined,
                disabled: node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.disabled : undefined,
                revision: node?.closest<HTMLElement>('.declarative-surface')?.dataset.surfaceRevision });
        };
        for (const name of ['input', 'change', 'focusin']) document.addEventListener(name, dom, true);
        window.addEventListener('blur', dom);
        const observer = new MutationObserver((changes) => {
            for (const change of changes) if (change.target instanceof HTMLElement) record({ kind: 'attribute',
                node: change.target.dataset.surfaceNodeId, attribute: change.attributeName,
                value: change.target.getAttribute(change.attributeName!) });
        });
        observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-surface-revision', 'disabled'] });
        scope.__tileInputTrace = { stop: () => {
            observer.disconnect();
            for (const name of ['input', 'change', 'focusin']) document.removeEventListener(name, dom, true);
            window.removeEventListener('blur', dom); delete scope.__tileInputTrace; return rows;
        } };
    });
    return () => page.evaluate(() => (window as unknown as { __tileInputTrace?: { stop: () => unknown[] } }).__tileInputTrace?.stop() ?? []);
}
