import assert from 'node:assert/strict';
import path from 'node:path';
import { art, connectOutput, sourceSnapshot, type ArtRecord, type ArtSources } from './artProbe.ts';
import { openProbe, readJson, until, writeJson } from './probeSession.ts';

const root = path.resolve(process.argv[2]);
const { runtime, request } = await openProbe(root);
const sources = await readJson<ArtSources>(path.join(root, 'art-sources.json'));
const readSource = () => request<ArtRecord>('GET', `/v1/surfaces/instances/${sources.form.instanceId}`);
const browser = await connectOutput(runtime.outputCdpPort);
const active = new Set(['accepted', 'queued', 'running', 'cancel_requested']);
const seen = new Set<string>(), batches: { elapsedMs: number; retainedAcks: number; revision: number }[] = [];
const started = performance.now();
let maximumRetained = 0;
try {
    const page = browser.contexts().flatMap((context) => context.pages()).find((page) => page.url().endsWith('#tile-output'));
    assert(page); page.setDefaultTimeout(10000); await page.bringToFront();
    const name = art(page, 'form-b').locator('[data-surface-node-id="project_name"]');
    const notes = art(page, 'form-b').locator('[data-surface-node-id="notes"]');
    const original = await readSource();
    const originalState = sourceSnapshot(original, sources.form).authoritativeState as Record<string, unknown>;
    assert.equal(originalState.projectName, 'Recovered Art');
    const originalNotes = String(originalState.notes ?? '');
    async function settled(projectName: string, notesValue: string) {
        return until(readSource, (record) => {
            const state = sourceSnapshot(record, sources.form).authoritativeState as Record<string, unknown>;
            return state.projectName === projectName && state.notes === notesValue && !record.pendingEvents.length
                && Object.values(record.eventAcks).every((ack) => !active.has(ack.status));
        }, 'stress edits reach the ordinary source and finish', 30000);
    }
    for (let index = 0; index < 32; index++) {
        assert(performance.now() - started < 360_000, 'bounded Art stress exceeded six minutes');
        const project = `Stress project ${index}`, note = `Stress notes ${index}`;
        const before = performance.now();
        await name.fill(project); await name.press('Tab');
        await notes.fill(note); await notes.press('Tab');
        await until(() => page.locator('.tile-art-plane').getAttribute('aria-busy'),
            (busy) => busy === 'false', 'host edit queue drained', 30000);
        const record = await settled(project, note);
        const retained = Object.keys(record.eventAcks);
        retained.forEach((id) => seen.add(id));
        maximumRetained = Math.max(maximumRetained, retained.length);
        assert(retained.length <= 64, 'one wall view must retain at most 64 acknowledgements');
        assert.equal(Object.keys(record.attachments).length, 2, 'stress must reuse the same source and wall attachment');
        assert.deepEqual(record.latestResult, original.latestResult, 'stress edits must preserve the formal result');
        batches.push({ elapsedMs: Math.round(performance.now() - before), retainedAcks: retained.length,
            revision: sourceSnapshot(record, sources.form).revision });
        await writeJson(path.join(root, 'stress-progress.json'), { distinctAcks: seen.size, maximumRetained, batches });
        if (seen.size >= 72 && performance.now() - started >= 60_000) break;
    }
    assert(seen.size >= 72, 'stress must cross the 64-ack retention boundary');
    assert(performance.now() - started >= 60_000, 'stress must observe at least one minute of input');
    await name.fill('Recovered Art'); await name.press('Tab');
    await notes.fill(originalNotes); await notes.press('Tab');
    await until(() => page.locator('.tile-art-plane').getAttribute('aria-busy'),
        (busy) => busy === 'false', 'restored host edit queue drained', 30000);
    await settled('Recovered Art', originalNotes);
    const result = { passed: true, phase: 'stress', durationMs: Math.round(performance.now() - started),
        distinctAcks: seen.size, maximumRetained, batches, sourceAndFormalResultPreserved: true,
        timingScope: 'UI batch to authoritative source completion; not physical display latency' };
    await writeJson(path.join(root, 'stress-result.json'), result);
    console.log(JSON.stringify(result));
} finally { await browser.close(); }
