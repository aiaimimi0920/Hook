import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import type { WallLayout, WallStateSnapshot } from '../../../src/services/wallTypes.ts';
import { art, connectOutput, exitTile, screenshotPixels, sourceSnapshot, type ArtRecord, type ArtSource, type ArtSources } from './artProbe.ts';
import { openProbe, readJson, until, writeJson } from './probeSession.ts';
import { traceArtInput } from './artInputTrace.ts';

const root = path.resolve(process.argv[2]), phase = process.argv[3] ?? 'art';
const recovery = phase === 'recovery' || phase === 'daemon-recovery';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { runtime, request } = await openProbe(root);
const sources = await readJson<ArtSources>(path.join(root, 'art-sources.json'));
const readSource = (source: ArtSource) => request<ArtRecord>('GET', `/v1/surfaces/instances/${source.instanceId}`);
const readWall = () => request<WallStateSnapshot>('GET', '/v1/walls/state');
const browser = await connectOutput(runtime.outputCdpPort);
const results: Record<string, unknown> = { phase };
let page: Page | undefined;
try {
    page = await until(async () => browser.contexts().flatMap((context) => context.pages())
        .find((candidate) => candidate.url().endsWith('#tile-output')), Boolean, 'owned output page');
    assert(page); page.setDefaultTimeout(10000); await page.bringToFront();
    const outputPage = page;
    if (phase === 'disconnect') {
        await until(() => outputPage.locator('.declarative-surface').count(), (count) => count === 0, 'disconnected Art view cleared', 25000);
        assert(await outputPage.locator('canvas').first().evaluate((canvas: HTMLCanvasElement) => {
            const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            return pixels.every((value) => value === 0);
        }), 'disconnected output must not retain stale media');
        results.disconnectedPresentationCleared = true;
        await writeJson(path.join(root, 'disconnect-result.json'), results);
        await browser.close(); process.exit(0);
    }
    const catalog = await until(readWall, (state) => state.endpoints.length === 1 && state.endpoints[0].online, 'physical endpoint');
    const endpoint = catalog.endpoints[0].endpoint;
    assert.equal(endpoint.deviceId, runtime.deviceId);
    assert(endpoint.renderModes.includes('surface_v1'));
    let layout: WallLayout = recovery ? catalog.layouts[0] : {
        protocolVersion: 'loom.wall.v1', wallId: 'art-wall', revision: catalog.revision + 1,
        bounds: { x: 0, y: 0, width: 1000, height: 600 },
        tiles: [{ tileId: 'physical-output', endpointId: endpoint.endpointId, rect: { x: 0, y: 0, width: 1000, height: 600 }, rotation: 'deg0' }],
        placements: [
            { placementId: 'form-a', source: { kind: 'surface', id: sources.form.instanceId }, rect: { x: 0, y: 0, width: 420, height: 600 },
                sourceCrop: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 0, interactive: true },
            { placementId: 'dashboard', source: { kind: 'surface', id: sources.dashboard.instanceId }, rect: { x: 460, y: 0, width: 540, height: 600 },
                sourceCrop: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 1, interactive: true },
        ],
    };
    async function applied() {
        await until(readWall, (state) => state.endpoints[0]?.appliedRevision === layout.revision, 'Art layout applied', 35000);
        await art(outputPage).waitFor({ state: 'visible' });
    }
    async function saveLayout() {
        const state = await readWall(); layout = { ...layout, revision: state.revision + 1 };
        await request('PUT', '/v1/walls/layouts', { baseRevision: state.revision, layout }); await applied();
    }
    async function stateValue(source: ArtSource, key: string, value: unknown) {
        return until(() => readSource(source), (record) => {
            const state = sourceSnapshot(record, source).authoritativeState as Record<string, unknown>;
            return state[key] === value && record.pendingEvents.length === 0;
        }, `source ${key} updated by real Art process`);
    }
    async function fill(placement: string, id: string, value: string, stateKey: string) {
        const control = art(outputPage, placement).locator(`[data-surface-node-id="${id}"]`);
        await control.fill(value); await control.press('Tab');
        const record = await stateValue(sources.form, stateKey, value);
        const revision = sourceSnapshot(record, sources.form).revision;
        await until(async () => Number(await art(outputPage, placement).getAttribute('data-surface-revision')),
            (current) => current >= revision, 'authoritative edit rendered on output');
    }
    async function submit() {
        const previous = new Set(Object.keys((await readSource(sources.form)).eventAcks));
        await art(outputPage, 'form-a').locator('[data-surface-node-id="submit"]').click();
        await outputPage.getByRole('alertdialog').waitFor();
        const record = await until(() => readSource(sources.form),
            (value) => Object.values(value.eventAcks).some((ack) => !previous.has(ack.eventId) && ack.status === 'awaiting_confirmation'), 'host confirmation');
        return Object.values(record.eventAcks).find((ack) => !previous.has(ack.eventId) && ack.status === 'awaiting_confirmation')!.eventId;
    }
    async function terminal(eventId: string, status: string) {
        return until(() => readSource(sources.form), (record) => record.eventAcks[eventId]?.status === status, `Art action ${status}`);
    }
    async function rapidInput() {
        const stopTrace = await traceArtInput(outputPage);
        try {
            const name = art(outputPage).locator('[data-surface-node-id="project_name"]');
            const notes = art(outputPage).locator('[data-surface-node-id="notes"]');
            const typed = 'Continuous keyboard 01234567890123456789';
            await name.click(); await name.press('Control+A');
            await outputPage.keyboard.type(typed, { delay: 45 });
            assert.equal(await name.inputValue(), typed, 'continuous native typing must preserve the newest draft');
            assert(await name.evaluate((node) => document.activeElement === node), 'server snapshots must preserve input focus');
            await name.press('Tab');
            await notes.fill('Rapid cross-field notes'); await notes.press('Tab');
            await stateValue(sources.form, 'projectName', typed);
            await stateValue(sources.form, 'notes', 'Rapid cross-field notes');
            const batchesMs: number[] = [];
            for (let index = 0; index < 3; index++) {
                const started = performance.now(), project = `Rapid project ${index}`, note = `Rapid notes ${index}`;
                await name.fill(project); await name.press('Tab');
                await notes.fill(note); await notes.press('Tab');
                await stateValue(sources.form, 'projectName', project); await stateValue(sources.form, 'notes', note);
                batchesMs.push(Math.round(performance.now() - started));
            }
            results.rapidInput = { characters: typed.length, keyIntervalMs: 45, focusPreserved: true, crossFieldState: true, batchesMs };
        } finally { await writeJson(path.join(root, 'rapid-input-trace.json'), await stopTrace()); }
    }
    if (recovery) {
        await applied();
        await until(() => art(outputPage, 'form-b').locator('[data-surface-node-id="project_name"]').inputValue(),
            (value) => value === (phase === 'recovery' ? 'Moved Art' : 'Recovered Art'), 'reopened mirror preserves source state');
        await fill('form-b', 'project_name', phase === 'recovery' ? 'Recovered Art' : 'Restarted Art', 'projectName');
        const record = await readSource(sources.form);
        assert.equal(record.latestResult?.outputs.submission.kind, 'value');
        assert.equal((record.latestResult?.outputs.submission as { kind: 'value'; value: { projectName: string } }).value.projectName, 'Tile Art');
        results.reconnectedInput = true; results.formalResultPreserved = true;
        results.ordinarySourceAttachment = sources.form.attachmentId;
        if (phase === 'daemon-recovery') {
            assert(await art(outputPage, 'dashboard').locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
                'persisted dashboard resource must be decoded after daemon restart');
            results.daemonRestartResourcePainted = true;
            await exitTile(outputPage);
            await until(readWall, (state) => !state.endpoints[0]?.online, 'output exit releases presenter');
            await until(() => readSource(sources.form), (record) => Object.keys(record.attachments).length === 1, 'ephemeral attachment cleanup');
            assert.equal(Object.keys((await readSource(sources.form)).eventAcks).length, 0, 'exiting clears only wall-owned acknowledgement history');
            results.ackHistoryCleared = true;
            results.sourceSurvivesExit = true;
        }
    } else {
        await saveLayout();
        results.physicalOutput = endpoint.pixelSize;
        await rapidInput();
        await fill('form-a', 'project_name', 'Tile Art', 'projectName');
        await fill('form-a', 'notes', 'Real process runtime', 'notes');
        assert.equal((await readSource(sources.form)).latestResult ?? null, null);
        results.realProcessInput = true;

        let eventId = await submit();
        await outputPage.locator('.surface-confirmation-button--reject').click();
        await terminal(eventId, 'cancelled');
        assert.equal((await readSource(sources.form)).latestResult ?? null, null); results.confirmationRejected = true;
        eventId = await submit();
        await outputPage.locator('.surface-confirmation-button--approve').click();
        await outputPage.locator('.tile-art-actions button').filter({ hasText: 'form_submit' }).click();
        await terminal(eventId, 'cancelled');
        // Outwait the actual prototype's 1.5-second process execution, then verify no late commit.
        await new Promise((resolve) => setTimeout(resolve, 2200));
        assert.equal((await readSource(sources.form)).latestResult ?? null, null); results.acceptedActionCancelled = true;
        eventId = await submit();
        await outputPage.locator('.surface-confirmation-button--approve').click();
        const submitted = await terminal(eventId, 'succeeded');
        assert.deepEqual((submitted.latestResult?.outputs.submission as { kind: 'value'; value: unknown }).value,
            { projectName: 'Tile Art', notes: 'Real process runtime', submitted: true });
        results.confirmationApproved = true; results.formalRevision = submitted.latestResult?.resultRevision;

        await art(outputPage, 'dashboard').locator('[data-surface-node-id="refresh"]').click();
        await stateValue(sources.dashboard, 'status', 'ready');
        await outputPage.waitForFunction(() => {
            const image = document.querySelector<HTMLImageElement>('[data-surface-node-id="chart"]');
            return Boolean(image?.complete && image.naturalWidth > 0 && image.src.startsWith('blob:'));
        });
        results.dashboardResourcePainted = await art(outputPage, 'dashboard').locator('img').evaluate((image: HTMLImageElement) =>
            ({ width: image.naturalWidth, height: image.naturalHeight }));

        layout = { ...layout, placements: [
            { ...layout.placements[0], rect: { x: 0, y: 0, width: 400, height: 600 } },
            { ...layout.placements[0], placementId: 'form-b', rect: { x: 400, y: 0, width: 300, height: 600 }, zIndex: 2 },
            { ...layout.placements[1], rect: { x: 700, y: 0, width: 300, height: 600 }, zIndex: 3 },
        ] }; await saveLayout();
        await fill('form-b', 'project_name', 'Shared Art', 'projectName');
        await until(() => art(outputPage).locator('[data-surface-node-id="project_name"]').inputValue(), (value) => value === 'Shared Art', 'mirror fanout');
        assert.equal(await art(outputPage).getAttribute('data-surface-attachment-id'), await art(outputPage, 'form-b').getAttribute('data-surface-attachment-id'));
        assert.equal(Object.keys((await readSource(sources.form)).attachments).length, 2);
        results.repeatedPlacementSharesAttachment = true;

        const size = await outputPage.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        const points = [20, 420, 720].map((x) => ({ x: x / 1000 * size.width, y: 590 / 600 * size.height }));
        const before = await screenshotPixels(outputPage, points);
        const image = await outputPage.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
            const context = canvas.getContext('2d')!; context.fillStyle = 'rgba(255,0,0,0.5)'; context.fillRect(0, 0, 4, 4);
            return canvas.toDataURL('image/png').split(',')[1];
        });
        const uploaded = await request<{ resource: { resourceId: string } }>('POST', '/v1/surfaces/resources',
            { kind: 'image', mime: 'image/png', dataBase64: image });
        layout = { ...layout, placements: [...layout.placements, {
            placementId: 'transparent-red', source: { kind: 'image', id: uploaded.resource.resourceId },
            rect: { x: 0, y: 0, width: 1000, height: 600 }, sourceCrop: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 1, interactive: false,
        }] }; await saveLayout();
        const after = await screenshotPixels(outputPage, points);
        for (let channel = 0; channel < 3; channel++) {
            const expected = (before[0][channel] + (channel === 0 ? 255 : 0)) / 2;
            assert(Math.abs(after[0][channel] - expected) <= 3, 'transparent media must blend above the lower Art exactly once');
        }
        assert.deepEqual(after.slice(1), before.slice(1), 'higher Art must cover the interleaved media');
        await fill('form-b', 'notes', 'Mixed-layer input', 'notes');
        results.interleavedAlpha = { before, after }; results.mixedLayerInput = true;

        layout = { ...layout, tiles: [{ ...layout.tiles[0], rotation: 'deg90' }],
            placements: layout.placements.map((placement) => placement.placementId === 'form-b'
                ? { ...placement, sourceCrop: { x: 0, y: 0, width: 0.95, height: 1 } } : placement) };
        await saveLayout(); await fill('form-b', 'project_name', 'Moved Art', 'projectName');
        results.cropRotationInput = true;
        assert.equal((await readSource(sources.form)).latestResult?.resultRevision, submitted.latestResult?.resultRevision);
        results.editDoesNotReplaceFormalResult = true;
        const manager = await connectOutput(runtime.cdpPort);
        try {
            const managerPage = manager.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().endsWith('#tile'));
            assert(managerPage); await exitTile(managerPage);
        } finally { await manager.close(); }
        await outputPage.bringToFront(); await fill('form-b', 'notes', 'Headless Art', 'notes');
        results.managerClosedInput = true;
        await outputPage.screenshot({ path: path.join(repo, 'output/playwright', `tile-art-${path.basename(root)}.png`) });
        assert(runtime.outputPid); process.kill(runtime.outputPid);
        await until(readWall, (state) => !state.endpoints[0]?.online, 'crashed output presenter expires', 25000);
        await until(() => readSource(sources.form), (record) => Object.keys(record.attachments).length === 1, 'crashed wall mirror cleanup');
        assert.equal(Object.keys((await readSource(sources.form)).eventAcks).length, 0, 'crashed view history must not accumulate on its source');
        results.ackHistoryCleared = true;
        results.outputCrashPreservesSource = true;
    }
    await writeJson(path.join(root, `${phase}-result.json`), results);
    console.log(JSON.stringify(results));
} catch (error) {
    await writeJson(path.join(root, recovery ? 'recovery-failure.json' : 'art-failure.json'), {
        results, form: await readSource(sources.form).catch(() => null), dashboard: await readSource(sources.dashboard).catch(() => null),
        page: await page?.evaluate(() => ({ notices: [...document.querySelectorAll('[role=status]')].map((node) => node.textContent),
            geometry: [...document.querySelectorAll('.tile-art-viewport, .declarative-surface, [data-surface-node-id="root"], [data-surface-node-id="submit"]')]
                .map((node) => ({ tag: node.tagName, class: node.className, rect: node.getBoundingClientRect().toJSON(),
                    scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflow: getComputedStyle(node).overflow })) })).catch(() => null),
    });
    await page?.screenshot({ path: path.join(repo, 'output/playwright', `tile-art-failure-${path.basename(root)}.png`) }).catch(() => {});
    throw error;
} finally { await browser.close(); }
