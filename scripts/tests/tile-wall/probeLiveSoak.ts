import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { WallStateSnapshot } from '../../../src/services/wallTypes.ts';
import { connectOutput } from './artProbe.ts';
import { traceNativeInput } from './nativeInputTrace.ts';
import { openProbe, readJson, sampleJson, until, writeJson } from './probeSession.ts';

interface Source { frames: number; errorCode?: string | null; pressedMouseButtons: number; pressedKeyCount: number }
const root = path.resolve(process.argv[2]);
const { runtime, request } = await openProbe(root);
assert(runtime.soakSeconds && runtime.soakSeconds >= 120 && runtime.soakSeconds <= 600);
const source = await readJson<{ sessionId: string; targets?: Record<string, [number, number]> }>(path.join(root, 'input-source-ready.json'));
const fixture = await readJson<{ targets: Record<string, [number, number]> }>(path.join(root, 'fixture-ready.json'));
const sourceState = () => sampleJson<Source>(path.join(root, 'source-status.json'));
const fixtureState = () => sampleJson<{ clicks: number }>(path.join(root, 'fixture-state.json'));
const browser = await connectOutput(runtime.outputCdpPort);
const rows: { ms: number; frames: number; hash: number; clicks: number; inputMs: number }[] = [];
let stopTrace: Awaited<ReturnType<typeof traceNativeInput>> | undefined;
let captureFailure: (() => Promise<void>) | undefined;
try {
    const page = await until(async () => browser.contexts().flatMap((context) => context.pages())
        .find((candidate) => candidate.url().endsWith('#tile-output')), Boolean, 'soak physical output');
    assert(page); await page.bringToFront();
    stopTrace = await traceNativeInput(page);
    captureFailure = async () => {
        await writeJson(path.join(root, 'soak-failure-state.json'), { source: await sourceState(), fixture: await fixtureState(),
            wall: await request<WallStateSnapshot>('GET', '/v1/walls/state'),
            notices: (await page.getByRole('status').allTextContents()).map((text) => text.slice(0, 512)) });
        await page.screenshot({ path: path.join(root, 'soak-failure.png') });
    };
    const state = await request<WallStateSnapshot>('GET', '/v1/walls/state');
    const endpoint = state.endpoints.find((row) => row.online && row.endpoint.deviceId === runtime.deviceId); assert(endpoint);
    const layout = state.layouts.find((wall) => wall.tiles.some((tile) => tile.endpointId === endpoint.endpoint.endpointId)); assert(layout);
    const tile = layout.tiles.find((value) => value.endpointId === endpoint.endpoint.endpointId); assert(tile?.rotation === 'deg0');
    const placement = layout.placements.find((value) => value.source.kind === 'live' && value.source.id === source.sessionId);
    assert(placement?.interactive); assert.equal(endpoint.appliedRevision, layout.revision);
    const canvas = await page.locator('canvas').first().boundingBox(); assert(canvas);
    const [x, y] = (source.targets ?? fixture.targets).action;
    const u = (x - placement.sourceCrop.x) / placement.sourceCrop.width;
    const v = (y - placement.sourceCrop.y) / placement.sourceCrop.height;
    assert(u >= 0 && u < 1 && v >= 0 && v < 1);
    const target = { x: canvas.x + (placement.rect.x + placement.rect.width * u - tile.rect.x) / tile.rect.width * canvas.width,
        y: canvas.y + (placement.rect.y + placement.rect.height * v - tile.rect.y) / tile.rect.height * canvas.height };
    const session = await request<{ session: { frameStream: { codec: string; width: number; height: number } } }>('GET', `/v1/live/sessions/${source.sessionId}`);
    const stream = session.session.frameStream; assert.equal(stream.codec, 'raw_bgra');
    const frameBytes = stream.width * stream.height * 4;
    assert(Number.isSafeInteger(frameBytes) && frameBytes > 0 && frameBytes <= 16 * 1024 * 1024);
    const screenshots = path.resolve(root, '../../output/playwright', path.basename(root));
    await mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'soak-start.png') });
    const before = await sourceState(), start = performance.now();
    let previousFrames = before.frames, previousHash: number | undefined;
    while (performance.now() - start < runtime.soakSeconds * 1000) {
        const clickedBefore = await fixtureState(), inputStart = performance.now();
        await page.mouse.click(target.x, target.y);
        const clicked = await until(fixtureState, (value) => value.clicks > clickedBefore.clicks, 'soak native input');
        assert.equal(clicked.clicks, clickedBefore.clicks + 1);
        const inputMs = performance.now() - inputStart;
        const current = await until(sourceState, (value) => value.frames > previousFrames && value.pressedMouseButtons === 0, 'soak source progress');
        assert(!current.errorCode); assert.equal(current.pressedKeyCount, 0);
        const hash = await page.evaluate(() => {
            const canvas = document.querySelector('canvas')!;
            const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
            let hash = 2166136261;
            for (let index = 0; index < bytes.length; index += 256) hash = Math.imul(hash ^ bytes[index], 16777619);
            return hash >>> 0;
        });
        assert.notEqual(hash, previousHash, 'dynamic output must keep presenting fresh source pixels');
        previousFrames = current.frames; previousHash = hash;
        rows.push({ ms: performance.now() - start, frames: current.frames, hash, clicks: clicked.clicks, inputMs });
        assert(rows.length <= 301, 'soak observations must stay bounded');
        const now = await request<WallStateSnapshot>('GET', '/v1/walls/state');
        assert.equal(now.endpoints.find((value) => value.endpoint.endpointId === endpoint.endpoint.endpointId)?.appliedRevision, layout.revision);
        await writeJson(path.join(root, 'soak-progress.json'), { observations: rows.length, elapsedMs: performance.now() - start, frames: current.frames });
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, rows.length * 2000 - (performance.now() - start))));
    }
    const after = await sourceState(), elapsedMs = performance.now() - start;
    assert(rows.length >= Math.floor(runtime.soakSeconds / 2.5), 'soak must not hide sustained stalls behind long waits');
    const latencies = rows.map((row) => row.inputMs).sort((a, b) => a - b);
    await page.screenshot({ path: path.join(screenshots, 'soak-end.png') });
    await writeJson(path.join(root, 'soak-result.json'), { passed: true, requestedSeconds: runtime.soakSeconds, elapsedMs,
        sourceBefore: before, sourceAfter: after, observations: rows,
        inputToObservedSourceMs: { samples: rows.length, median: latencies[Math.floor(latencies.length / 2)],
            p95: latencies[Math.floor((latencies.length - 1) * 0.95)], max: latencies.at(-1), observationPollMs: 50 },
        rawPayload: { width: stream.width, height: stream.height, frameBytes, frames: after.frames - before.frames,
            bytes: (after.frames - before.frames) * frameBytes,
            bytesPerSecond: (after.frames - before.frames) * frameBytes * 1000 / elapsedMs,
            method: 'successful source writes times fixed raw BGRA frame size; excludes framing, retries and NIC traffic' },
        screenshotObservationMs: 2000 });
} catch (error) {
    await captureFailure?.().catch(() => undefined);
    await writeJson(path.join(root, 'soak-failure.json'), { observations: rows,
        error: error instanceof Error ? error.message : 'soak failed' });
    throw error;
} finally {
    if (stopTrace) await writeJson(path.join(root, 'soak-input-trace.json'), await stopTrace());
    await browser.close();
}
