import assert from 'node:assert/strict';
import path from 'node:path';
import type { Page } from 'playwright';
import type { WallLayout, WallStateSnapshot } from '../../../src/services/wallTypes.ts';
import { screenshotPixels } from './artProbe.ts';
import { openProbe, until, writeJson } from './probeSession.ts';

interface SourceState { frames: number; pressedMouseButtons: number; pressedKeyCount: number; remoteControlActive: boolean }
interface LiveDisplayProbe {
    root: string;
    page: Page;
    layout: WallLayout;
    request: Awaited<ReturnType<typeof openProbe>>['request'];
    sourceState: () => Promise<SourceState>;
    fixtureState: () => Promise<{ clicks: number; keyEdges: number }>;
    point: { x: number; y: number };
    click: (label: string) => Promise<void>;
    frameHash: () => Promise<number>;
}

/** Exercise display controls against the same live WGC source and native held input. */
export async function verifyLiveDisplay(probe: LiveDisplayProbe) {
    const { root, page, request, sourceState, fixtureState, point, click, frameHash } = probe;
    let layout = probe.layout;
    const readWall = () => request<WallStateSnapshot>('GET', '/v1/walls/state');
    const endpointId = layout.tiles[0].endpointId;
    const screenshots = path.resolve(root, '../../output/playwright', path.basename(root));
    const beforeFrames = (await sourceState()).frames;
    async function hold() {
        await click('native control before display command');
        await page.keyboard.down('Control'); await page.mouse.move(point.x, point.y); await page.mouse.down();
        await until(sourceState, (state) => state.pressedKeyCount > 0 && state.pressedMouseButtons > 0, 'held source input before display control');
    }
    async function released() {
        await until(sourceState, (state) => !state.remoteControlActive && !state.pressedKeyCount && !state.pressedMouseButtons,
            'display control releases native source input', 12000);
        await page.keyboard.up('Control'); await page.mouse.up();
    }
    async function mode(value: 'running' | 'frozen' | 'black', outcome = 'applied') {
        const previous = await readWall();
        const next = await request<WallStateSnapshot>('PUT', '/v1/walls/presentation', {
            baseRevision: previous.revision, wallId: layout.wallId, mode: value,
        });
        const oldRevision = layout.revision; layout = next.layouts[0];
        assert.deepEqual(layout.placements, probe.layout.placements, 'display controls retain the live source reference');
        if (value === 'running') {
            assert(layout.revision > oldRevision);
            await until(readWall, (state) => state.endpoints[0]?.appliedRevision === layout.revision, 'resumed live mapping', 35000);
        } else {
            assert.equal(layout.revision, oldRevision);
            await until(readWall, (state) => state.endpoints[0]?.presentation?.revision === next.presentations![0].revision
                && state.endpoints[0].presentation.outcome === outcome, `live ${value} report`, 35000);
        }
    }

    await hold();
    const initial = await readWall();
    const identified = await request<WallStateSnapshot>('POST', '/v1/walls/endpoints/identify', { endpointId });
    assert.equal(identified.revision, initial.revision);
    await released();
    const marker = page.getByRole('dialog', { name: '识别物理屏幕', exact: true });
    await marker.waitFor({ state: 'visible' });
    await until(readWall, (state) => state.endpoints[0]?.identification?.applied === true, 'live identification reported');
    const identificationScreenshot = path.join(screenshots, 'live-identification.png');
    await page.screenshot({ path: identificationScreenshot });
    await page.keyboard.press('Escape'); await marker.waitFor({ state: 'detached' });
    await until(readWall, (state) => !state.endpoints[0]?.identification
        && state.endpoints[0]?.appliedRevision === layout.revision, 'live input resumes after identification');
    assert(!page.isClosed());

    await hold();
    await mode('frozen'); await released();
    await page.mouse.move(1, 1);
    const frozenHash = await frameHash(), frozenSha256 = await liveCanvasDigest(page), frozenSource = await sourceState();
    await until(sourceState, (state) => state.frames >= frozenSource.frames + 3, 'WGC source continues while frozen');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(await liveCanvasDigest(page), frozenSha256, 'frozen live pixels changed while source advanced');
    const beforeInput = await fixtureState();
    await page.mouse.click(point.x, point.y); await page.keyboard.press('KeyQ');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const afterInput = await fixtureState();
    assert.equal(afterInput.clicks, beforeInput.clicks); assert.equal(afterInput.keyEdges, beforeInput.keyEdges);
    const frozenScreenshot = path.join(screenshots, 'live-frozen.png');
    await page.screenshot({ path: frozenScreenshot });
    await mode('black');
    const blackPixels = await screenshotPixels(page, [{ x: 10, y: 10 }, { x: 200, y: 200 }, { x: 600, y: 400 }]);
    assert(blackPixels.every((pixel) => pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0));
    const blackScreenshot = path.join(screenshots, 'live-black.png');
    await page.screenshot({ path: blackScreenshot });
    await mode('frozen', 'frame_unavailable');
    assert.equal((await readWall()).endpoints[0].appliedRevision, null);
    await mode('running');
    const first = await frameHash();
    await until(frameHash, (hash) => hash !== first && hash !== frozenHash, 'fresh dynamic Live pixels after resume');
    await click('native input after Live display resume');
    const afterFrames = (await sourceState()).frames;
    assert(afterFrames > beforeFrames);
    const resumedScreenshot = path.join(screenshots, 'live-resumed.png');
    await page.screenshot({ path: resumedScreenshot });
    const result = { nativeHeldInputReleased: true, identificationDidNotExit: true, frozenPixelsStable: true,
        sourceContinued: true, pausedSourceInputRejected: true, blackPixels, blackCannotRestoreFreeze: true,
        freshDynamicFramesAndInputResumed: true, frozenSha256, beforeFrames, afterFrames, layoutRevision: layout.revision,
        source: layout.placements[0].source, identificationScreenshot, frozenScreenshot, blackScreenshot, resumedScreenshot };
    await writeJson(path.join(root, 'live-display-result.json'), result);
    return { layout, result };
}

async function liveCanvasDigest(page: Page): Promise<string> {
    return page.evaluate(async () => {
        const canvas = document.querySelector('canvas')!;
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        const digest = await crypto.subtle.digest('SHA-256', pixels);
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    });
}
