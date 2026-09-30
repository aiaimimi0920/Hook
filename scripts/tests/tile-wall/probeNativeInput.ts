import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import type { WallLayout, WallStateSnapshot } from '../../../src/services/wallTypes.ts';
import { openProbe, readJson, sampleJson, until, writeJson } from './probeSession.ts';
import { verifyLiveDisplay } from './probeLiveDisplay.ts';
import { verifyNativeWheel } from './probeNativeWheel.ts';

interface FixtureState { clicks: number; keyEdges: number; dragEdges: number; trackValue: number; trackWheels: number; lastWheelDelta: number }
interface SourceState { frames: number; pressedMouseButtons: number; pressedKeyCount: number; remoteControlActive: boolean }
const root = path.resolve(process.argv[2]);
const recovery = process.argv[3] === 'recovery';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { runtime, request } = await openProbe(root);
const source = await readJson<{ sessionId: string; captureSessionId: string; targets?: Record<string, [number, number]> }>(path.join(root, 'input-source-ready.json'));
const fixture = await readJson<{ targets: Record<string, [number, number]> }>(path.join(root, 'fixture-ready.json'));
const fixtureState = () => sampleJson<FixtureState>(path.join(root, 'fixture-state.json'));
const sourceState = () => sampleJson<SourceState>(path.join(root, 'source-status.json'));
const wallState = () => request<WallStateSnapshot>('GET', '/v1/walls/state');
const browser = await connectCdp(runtime.outputCdpPort);
const results: Record<string, unknown> = { phase: recovery ? 'recovery' : 'exercise', source };
const latencies: number[] = [];
let observedPage: Page | undefined;
try {
    const page = await until(async () => browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().endsWith('#tile-output')),
        (candidate) => !!candidate, 'owned output page');
    assert(page);
    observedPage = page;
    await page.evaluate(() => {
        const trace: unknown[] = [];
        Object.assign(window, { wallProbeEvents: trace });
        new MutationObserver(() => {
            if (trace.length < 400) trace.push({ at: performance.now(), notice: document.querySelector('[role=status]')?.textContent ?? '' });
        }).observe(document.querySelector('.tile-output')!, { childList: true, subtree: true, characterData: true });
        for (const name of ['pointerdown', 'pointerup', 'pointerleave', 'lostpointercapture', 'keydown', 'keyup', 'blur', 'focus']) {
            window.addEventListener(name, (event) => {
                if (trace.length < 200) trace.push({ type: event.type, at: performance.now(), focus: document.hasFocus(),
                    target: event.target instanceof Element ? event.target.tagName : 'window',
                    keyCode: event instanceof KeyboardEvent ? event.keyCode : undefined });
            }, true);
        }
    });
    await page.locator('canvas').first().waitFor({ state: 'visible' });
    const catalog = await until(wallState, (state) => state.endpoints.length === 1 && state.endpoints[0].online, 'physical endpoint registration');
    const endpoint = catalog.endpoints[0].endpoint;
    assert.equal(endpoint.deviceId, runtime.deviceId);
    let layout: WallLayout = recovery ? catalog.layouts[0] : {
        protocolVersion: 'loom.wall.v1', wallId: 'native-input-wall', revision: catalog.revision + 1,
        bounds: { x: 0, y: 0, width: 200, height: 100 },
        tiles: [{ tileId: 'physical-output', endpointId: endpoint.endpointId, rect: { x: 0, y: 0, width: 200, height: 100 }, rotation: 'deg0' }],
        placements: [{ placementId: 'native-window', source: { kind: 'live', id: source.sessionId },
            rect: { x: 0, y: 0, width: 200, height: 100 }, sourceCrop: { x: 0, y: 0, width: 1, height: 1 }, zIndex: 0, interactive: true }],
    };
    async function applied() {
        await until(wallState, (state) => state.endpoints[0]?.appliedRevision === layout.revision, 'native layout applied', 35000);
        await page!.waitForFunction(([width, height]) => {
            const canvas = document.querySelector('canvas');
            return canvas?.width === width && canvas.height === height;
        }, [endpoint.pixelSize.width, endpoint.pixelSize.height]);
    }
    async function saveLayout() {
        const state = await wallState(); layout = { ...layout, revision: state.revision + 1 };
        await request('PUT', '/v1/walls/layouts', { baseRevision: state.revision, layout });
        await applied();
    }
    if (!recovery) await saveLayout(); else await applied();
    const canvas = await page.locator('canvas').first().boundingBox();
    assert(canvas);
    function point(name: string) {
        const [x, y] = (source.targets ?? fixture.targets)[name];
        const crop = layout.placements[0].sourceCrop;
        const u = (x - crop.x) / crop.width, v = (y - crop.y) / crop.height;
        assert(u >= 0 && u < 1 && v >= 0 && v < 1, 'fixture target must remain inside the explicit crop');
        const [a, b] = layout.tiles[0].rotation === 'deg90' ? [v, 1 - u] : [u, v];
        return { x: canvas!.x + a * canvas!.width, y: canvas!.y + b * canvas!.height };
    }
    async function clickAction(label: string) {
        const before = await fixtureState(), target = point('action'), started = performance.now();
        await page!.mouse.click(target.x, target.y);
        try { await until(fixtureState, (value) => value.clicks > before.clicks, label, 10000); }
        catch (error) {
            await writeJson(path.join(root, 'input-failure.json'), { label, before, fixture: await fixtureState(),
                source: await sourceState(), live: await request('GET', `/v1/live/sessions/${source.sessionId}`).catch(() => null),
                page: await page!.evaluate(() => ({ focus: document.hasFocus(), status: document.querySelector('[role=status]')?.textContent,
                    trace: (window as unknown as { wallProbeEvents: unknown[] }).wallProbeEvents })) });
            await page!.screenshot({ path: path.join(repo, 'output/playwright', `tile-input-failure-${path.basename(root)}.png`) });
            throw error;
        }
        latencies.push(performance.now() - started);
    }
    async function released(label: string) {
        await until(sourceState, (state) => state.pressedKeyCount === 0 && state.pressedMouseButtons === 0 && !state.remoteControlActive, label, 12000);
    }
    if (!recovery) {
        await page.bringToFront();
        await clickAction('native button click'); results.click = true;
        assert(await page.evaluate(() => {
            const canvas = document.querySelector('canvas')!, rect = canvas.getBoundingClientRect();
            return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === canvas
                && getComputedStyle(document.querySelector('.tile-input-status')!).pointerEvents === 'none';
        }), 'authority feedback must leave the actual output visible and hit-testable');
        results.authorityNoticePassthrough = true;
        let before = await fixtureState();
        const start = point('action'), end = point('dragEnd');
        await page.mouse.move(start.x, start.y); await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
        await until(fixtureState, (value) => value.dragEdges >= before.dragEdges + 3, 'native drag');
        await until(sourceState, (value) => value.pressedMouseButtons === 0, 'native drag release');
        assert.equal((await fixtureState()).clicks, before.clicks, 'dragging a button must not activate it');
        results.drag = true;
        await clickAction('keyboard focus');
        before = await fixtureState();
        await page.keyboard.press('KeyA');
        await until(fixtureState, (value) => value.keyEdges >= before.keyEdges + 2, 'native key edges'); results.keyboard = true;
        results.wheel = await verifyNativeWheel(page, root, point('action'), point('track'), fixtureState);

        layout = { ...layout, tiles: [{ ...layout.tiles[0], rotation: 'deg90' }],
            placements: [{ ...layout.placements[0], sourceCrop: { x: 0, y: 0, width: 0.95, height: 1 } }] };
        await saveLayout(); await clickAction('rotated cropped native click'); results.cropRotation = true;
        await page.keyboard.down('Shift');
        await until(sourceState, (value) => value.pressedKeyCount > 0, 'held source key');
        await saveLayout(); await released('layout swap releases source key');
        await page.keyboard.up('Shift'); results.layoutRelease = true;

        await clickAction('focus after layout replacement');
        await page.keyboard.down('Control');
        await until(sourceState, (value) => value.pressedKeyCount > 0, 'held control before blur');
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await released('browser blur releases source'); await page.keyboard.up('Control');
        results.browserBlurRelease = true;

        const manager = await connectCdp(runtime.cdpPort);
        try {
            const control = manager.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().endsWith('#tile'));
            assert(control, 'owned terminal manager page');
            await invokeExit(control);
        } finally { await manager.close(); }
        await page.bringToFront();
        const firstHash = await frameHash(page);
        await until(() => frameHash(page), (hash) => hash !== firstHash, 'dynamic output after manager closes');
        results.headlessDynamicDisplay = true;
        const display = await verifyLiveDisplay({ root, page, layout, request, sourceState, fixtureState,
            point: point('action'), click: clickAction, frameHash: () => frameHash(page) });
        layout = display.layout; results.liveDisplay = display.result;
        for (let index = 0; index < 20; index++) await clickAction('bounded native input stress');
        latencies.sort((a, b) => a - b);
        results.inputToObservedSourceMs = { samples: latencies.length, median: latencies[Math.floor(latencies.length / 2)],
            p95: latencies[Math.floor((latencies.length - 1) * 0.95)], max: latencies.at(-1), observationPollMs: 50 };
        await page.screenshot({ path: path.join(repo, 'output/playwright', `tile-input-${path.basename(root)}.png`) });
        await page.keyboard.down('Control');
        const target = point('action'); await page.mouse.move(target.x, target.y); await page.mouse.down();
        await until(sourceState, (state) => state.pressedKeyCount > 0 && state.pressedMouseButtons > 0, 'held key and button before output crash');
        assert(runtime.outputPid, 'owned output PID'); process.kill(runtime.outputPid);
        await released('output crash expires native input authority'); results.crashRelease = true;
        await until(wallState, (state) => !state.endpoints[0]?.online, 'crashed presenter lease expires', 22000);
    } else {
        await page.bringToFront();
        await clickAction('reconnected output operates unchanged source'); results.reconnect = true;
        await writeJson(path.join(root, 'stop-source'), { requested: true });
        const summary = await until(async () => {
            try { return await readJson<{ workersJoined: boolean; timedOut: boolean }>(path.join(root, 'source-summary.json')); }
            catch { return undefined; }
        }, (value) => value?.workersJoined === true, 'native worker cleanup');
        assert(summary);
        assert.equal(summary.timedOut, false); results.nativeCleanup = summary;
        await until(() => page.locator('[role=status]').allTextContents(),
            (messages) => messages.some((message) => /tile_live|wall_live/.test(message)), 'source loss clears output');
        const isClear = await page.evaluate(() => {
            const canvas = document.querySelector('canvas')!;
            const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let offset = 3; offset < bytes.length; offset += 4) if (bytes[offset] !== 0) return false;
            return true;
        });
        assert(isClear, 'source loss must not retain stale source pixels'); results.sourceLossClears = true;
        await page.keyboard.press('Escape');
    }
    results.fixture = await fixtureState();
    await writeJson(path.join(root, recovery ? 'recovery-result.json' : 'input-result.json'), results);
    console.log(JSON.stringify(results));
} catch (error) {
    await writeJson(path.join(root, 'probe-failure.json'), { results, fixture: await fixtureState(), source: await sourceState(),
        page: await observedPage?.evaluate(() => ({ focus: document.hasFocus(), active: document.activeElement?.tagName,
            status: document.querySelector('[role=status]')?.textContent,
            trace: (window as unknown as { wallProbeEvents: unknown[] }).wallProbeEvents })).catch(() => null) });
    throw error;
} finally { await browser.close(); }

async function frameHash(page: Page): Promise<number> {
    return page.evaluate(() => {
        const canvas = document.querySelector('canvas')!;
        const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (let index = 0; index < bytes.length; index += 64) hash = Math.imul(hash ^ bytes[index], 16777619);
        return hash >>> 0;
    });
}

async function connectCdp(port: number) {
    const origin = `http://127.0.0.1:${port}`;
    await until(async () => {
        try { return (await fetch(origin + '/json/version', { signal: AbortSignal.timeout(1000) })).ok; }
        catch { return false; }
    }, Boolean, 'owned WebView2 CDP');
    return chromium.connectOverCDP(origin);
}

async function invokeExit(page: Page): Promise<void> {
    await page.evaluate(() => (window as unknown as { __TAURI_INTERNALS__: { invoke: (name: string) => Promise<void> } })
        .__TAURI_INTERNALS__.invoke('tile_exit')).catch((error: unknown) => {
            if (!(error instanceof Error) || !/closed|destroyed/i.test(error.message)) throw error;
        });
}
