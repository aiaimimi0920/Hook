import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import type { SurfaceActionAck } from '../../../src/services/surfaceProtocol.ts';
import type { WallLayout, WallStateSnapshot } from '../../../src/services/wallTypes.ts';
import { art, connectOutput, exitTile, screenshotPixels, sourceSnapshot, type ArtRecord, type ArtSources } from './artProbe.ts';
import { openProbe, readJson, until, writeJson } from './probeSession.ts';
import { verifyPresentationManagement } from './presentationManagement.ts';
import { tracePresentation } from './presentationTrace.ts';
import { verifyIdentification } from './probeIdentification.ts';

const root = path.resolve(process.argv[2]), phase = process.argv[3] ?? 'presentation';
assert(['presentation', 'recovery', 'disconnect', 'daemon-recovery'].includes(phase));
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { runtime, request } = await openProbe(root);
const sources = await readJson<ArtSources>(path.join(root, 'art-sources.json'));
const readWall = () => request<WallStateSnapshot>('GET', '/v1/walls/state');
const readForm = () => request<ArtRecord>('GET', `/v1/surfaces/instances/${sources.form.instanceId}`);
const browser = await connectOutput(runtime.outputCdpPort);
const results: Record<string, unknown> = { phase };
let page: Page | undefined;
let stopTrace: Awaited<ReturnType<typeof tracePresentation>> | undefined;
try {
    page = await until(async () => browser.contexts().flatMap((context) => context.pages())
        .find((page) => page.url().endsWith('#tile-output')), Boolean, 'owned output page');
    assert(page); page.setDefaultTimeout(10000); await page.bringToFront();
    const output = page;
    if (phase === 'presentation') stopTrace = await tracePresentation(output);
    const field = () => art(output).locator('[data-surface-node-id="project_name"]');
    async function cleared() {
        await until(() => output.locator('.declarative-surface').count(), (count) => count === 0, 'Art removed from black output', 25000);
        assert(await output.locator('canvas').first().evaluate((canvas: HTMLCanvasElement) =>
            canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.every((value) => value === 0)));
    }
    async function screenshot(label: string) {
        const file = path.join(repo, 'output/playwright', `tile-display-${path.basename(root)}-${label}.png`);
        await output.screenshot({ path: file }); return file;
    }
    if (phase === 'disconnect') {
        await cleared(); results.disconnectedFrozenContentCleared = true;
    } else {
        let catalog = await until(readWall, (state) => state.endpoints.length === 1 && state.endpoints[0].online, 'paired physical output');
        const endpoint = catalog.endpoints[0].endpoint;
        assert.equal(endpoint.deviceId, runtime.deviceId);
        let layout: WallLayout = catalog.layouts[0];
        async function applied() {
            await until(readWall, (state) => state.endpoints[0]?.appliedRevision === layout.revision, 'current running layout', 35000);
            await art(output).waitFor({ state: 'visible' });
        }
        async function control(mode: 'running' | 'frozen' | 'black', expected = 'applied') {
            catalog = await readWall();
            const previous = catalog.layouts[0].revision;
            const next = await request<WallStateSnapshot>('PUT', '/v1/walls/presentation', { baseRevision: catalog.revision, wallId: layout.wallId, mode });
            layout = next.layouts[0];
            if (mode === 'running') { assert(layout.revision > previous); await applied(); }
            else {
                assert.equal(layout.revision, previous, 'pause controls must preserve the retained mapping');
                const revision = next.presentations![0].revision;
                await until(readWall, (state) => state.endpoints[0]?.presentation?.revision === revision
                    && state.endpoints[0].presentation.outcome === expected, `${mode} acknowledged as ${expected}`, 35000);
            }
            return next;
        }
        async function formValue(value: string) {
            return until(readForm, (record) => (sourceSnapshot(record, sources.form).authoritativeState as { projectName?: string }).projectName === value
                && record.pendingEvents.length === 0, 'real Art source value', 35000);
        }
        async function fill(value: string) {
            await field().fill(value); await field().press('Tab');
            const record = await formValue(value), revision = sourceSnapshot(record, sources.form).revision;
            await until(() => art(output).getAttribute('data-surface-revision'), (value) => Number(value) >= revision,
                'terminal observes completed source edit');
        }
        if (phase === 'presentation') {
            const unassigned = await verifyIdentification({ root, output, runtime, request });
            const png = await output.evaluate(() => {
                const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
                const context = canvas.getContext('2d')!; context.fillStyle = '#123abc'; context.fillRect(0, 0, 4, 4);
                return canvas.toDataURL('image/png').split(',')[1];
            });
            const image = await request<{ resource: { resourceId: string } }>('POST', '/v1/surfaces/resources', { kind: 'image', mime: 'image/png', dataBase64: png });
            layout = { protocolVersion: 'loom.wall.v1', wallId: 'display-wall', revision: catalog.revision + 1,
                bounds: { x: 0, y: 0, width: 1000, height: 600 },
                tiles: [{ tileId: 'output', endpointId: endpoint.endpointId, rect: { x: 0, y: 0, width: 1000, height: 600 }, rotation: 'deg0' }],
                placements: [
                    { placementId: 'image', source: { kind: 'image', id: image.resource.resourceId }, rect: { x: 0, y: 0, width: 1000, height: 600 },
                        sourceCrop: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 0, interactive: false },
                    { placementId: 'form-a', source: { kind: 'surface', id: sources.form.instanceId }, rect: { x: 0, y: 0, width: 480, height: 500 },
                        sourceCrop: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 1, interactive: true },
                    { placementId: 'dashboard', source: { kind: 'surface', id: sources.dashboard.instanceId }, rect: { x: 520, y: 0, width: 480, height: 500 },
                        sourceCrop: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 2, interactive: true },
                ] };
            await request('PUT', '/v1/walls/layouts', { baseRevision: catalog.revision, layout }); await applied();
            await fill('Before freeze');
            await art(output, 'dashboard').locator('[data-surface-node-id="refresh"]').click();
            await until(() => art(output, 'dashboard').locator('img').evaluateAll((images: HTMLImageElement[]) => images.length > 0
                && images.every((image) => image.complete && image.naturalWidth > 0)), Boolean, 'dashboard image decoded', 35000);
            const assigned = await verifyIdentification({ root, output, runtime, request }, sources.form);
            await output.bringToFront(); await fill('After identification');
            results.identification = { unassigned, assigned, resumedSourceInput: true };
            await writeJson(path.join(root, 'identification-result.json'), results.identification);
            results.management = await verifyPresentationManagement(root, runtime, readWall);
            catalog = await readWall(); layout = catalog.layouts[0];
            await output.bringToFront(); await applied();
            await control('frozen');
            assert.equal(await field().isEnabled(), false);
            await output.mouse.move(1, (await output.evaluate(() => innerHeight)) - 2);
            await new Promise((resolve) => setTimeout(resolve, 300));
            const frozenValue = await field().inputValue(), frozenRevision = await art(output).getAttribute('data-surface-revision');
            const imageUrl = await art(output, 'dashboard').locator('img').getAttribute('src');
            const frozenHash = createHash('sha256').update(await output.screenshot()).digest('hex');
            const record = await readForm(), current = sourceSnapshot(record, sources.form);
            const eventId = `display-source-${randomUUID()}`;
            const accepted = await request<SurfaceActionAck>('POST', `/v1/surfaces/instances/${sources.form.instanceId}/events`, {
                protocolVersion: 'loom.surface.v1', instanceId: sources.form.instanceId, attachmentId: sources.form.attachmentId,
                eventId, nodeId: 'project_name', event: 'input', action: 'form_validate', class: 'continuous',
                generation: record.descriptor.generation, baseRevision: current.revision, payload: { value: 'Source changed while frozen' },
            });
            assert(accepted.accepted); await formValue('Source changed while frozen');
            await new Promise((resolve) => setTimeout(resolve, 5000));
            assert.equal(await field().inputValue(), frozenValue); assert.equal(await art(output).getAttribute('data-surface-revision'), frozenRevision);
            assert.equal(await art(output, 'dashboard').locator('img').getAttribute('src'), imageUrl);
            assert.equal(createHash('sha256').update(await output.screenshot()).digest('hex'), frozenHash, 'frozen output pixels changed');
            results.freezePreservesPixelsAndResource = true; results.sourceContinuesWhileFrozen = true;
            results.freezeScreenshot = await screenshot('frozen');
            await control('black'); await cleared();
            const pixels = await screenshotPixels(output, [{ x: 10, y: 10 }, { x: 200, y: 200 }, { x: 600, y: 400 }]);
            assert(pixels.every((pixel) => pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0));
            results.blackPixels = pixels; results.blackScreenshot = await screenshot('black');
            await control('frozen', 'frame_unavailable'); await cleared(); results.blackCannotBecomeRecoveredFreeze = true;
            await control('running');
            await until(() => field().inputValue(), (value) => value === 'Source changed while frozen', 'resume shows latest source');
            await fill('After resume'); results.resumedInput = true;
            for (let i = 0; i < 3; i++) { await control('frozen'); await control('running'); }
            assert.equal(Object.keys((await readForm()).attachments).length, 2, 'one ordinary source plus one temporary view');
            results.repeatedModeCycles = 3;
            await control('frozen');
            catalog = await readWall(); layout = { ...layout, revision: catalog.revision + 1, tiles: [{ ...layout.tiles[0], rotation: 'deg90' }] };
            await request('PUT', '/v1/walls/layouts', { baseRevision: catalog.revision, layout });
            await until(readWall, (state) => state.endpoints[0].presentation?.outcome === 'frame_unavailable', 'geometry change invalidates frozen frame', 35000);
            await cleared(); results.geometryChangeCannotReuseFrozenFrame = true;
            await control('running'); await fill('After geometry change');
            const manager = await connectOutput(runtime.cdpPort);
            try { const managerPage = manager.contexts().flatMap((context) => context.pages()).find((page) => page.url().endsWith('#tile'));
                assert(managerPage); await exitTile(managerPage); } finally { await manager.close(); }
            await output.bringToFront(); await control('frozen'); results.managerClosedControlWorks = true;
            results.ordinaryEventId = eventId; results.physicalOutput = endpoint.pixelSize;
            await writeJson(path.join(root, 'display-checkpoint.json'), { value: 'After geometry change', eventId });
            await writeJson(path.join(root, 'presentation-trace.json'), await stopTrace!()); stopTrace = undefined;
            assert(runtime.outputPid); process.kill(runtime.outputPid);
            await until(readWall, (state) => !state.endpoints[0].online, 'owned output crash lease expiry', 25000);
            await until(readForm, (record) => Object.keys(record.attachments).length === 1, 'crashed view cleanup');
            results.outputCrashPreservesSource = true;
        } else {
            const checkpoint = await readJson<{ value: string; eventId: string }>(path.join(root, 'display-checkpoint.json'));
            assert.equal(catalog.presentations?.[0].mode, 'frozen');
            await until(readWall, (state) => state.endpoints[0].presentation?.outcome === 'frame_unavailable', 'restarted output cannot recover frozen pixels', 35000);
            await cleared(); results.restartDidNotReplayFrozenFrame = true;
            await control('running'); await until(() => field().inputValue(), (value) => value === checkpoint.value, 'persisted source recovered');
            const value = phase === 'recovery' ? 'After output restart' : 'After daemon restart';
            await fill(value); results.resumedInput = true;
            assert((await readForm()).eventAcks[checkpoint.eventId], 'ordinary source history survives wall view cleanup');
            results.ordinarySourceHistoryPreserved = true;
            results.resumedScreenshot = await screenshot(phase);
            if (phase === 'recovery') {
                await control('frozen'); await writeJson(path.join(root, 'display-checkpoint.json'), { ...checkpoint, value });
            } else {
                await exitTile(output);
                await until(readWall, (state) => !state.endpoints[0].online, 'final presenter released');
                await until(readForm, (record) => Object.keys(record.attachments).length === 1, 'final temporary view removed');
                results.finalCleanupPreservesOrdinarySource = true;
            }
        }
    }
    await writeJson(path.join(root, `${phase}-result.json`), results); console.log(JSON.stringify(results));
} catch (error) {
    if (stopTrace) await writeJson(path.join(root, 'presentation-trace.json'), await stopTrace().catch(() => []));
    await writeJson(path.join(root, `${phase}-failure.json`), { results, wall: await readWall().catch(() => null),
        form: await readForm().catch(() => null), dashboard: await request<ArtRecord>('GET', `/v1/surfaces/instances/${sources.dashboard.instanceId}`).catch(() => null),
        notices: await page?.locator('[role="status"]').allTextContents().catch(() => []) });
    await page?.screenshot({ path: path.join(repo, 'output/playwright', `tile-display-${path.basename(root)}-${phase}-failure.png`) }).catch(() => {});
    throw error;
} finally { await browser.close(); }
