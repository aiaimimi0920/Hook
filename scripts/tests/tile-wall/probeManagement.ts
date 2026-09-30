import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Locator, Page } from 'playwright';
import type { WallRect, WallStateSnapshot } from '../../../src/services/wallTypes.ts';
import { connectOutput, screenshotPixels, type ArtRecord } from './artProbe.ts';
import { openProbe, readJson, sampleJson, until, writeJson } from './probeSession.ts';

// Mutations use the packaged Loom UI; HTTP only observes the isolated daemon's results.
const root = path.resolve(process.argv[2]);
const { runtime, request } = await openProbe(root);
assert(runtime.loomCdpPort && runtime.loomPid && runtime.loomExe);
const source = await readJson<{ sessionId: string; captureSessionId: string; targets?: Record<string, [number, number]> }>(path.join(root, 'input-source-ready.json'));
const { surfaceInstanceId, sourceAttachmentId } = await readJson<{ surfaceInstanceId: string; sourceAttachmentId: string }>(path.join(root, 'source-private.json'));
const fixture = await readJson<{ targets: Record<string, [number, number]> }>(path.join(root, 'fixture-ready.json'));
const wallState = () => request<WallStateSnapshot>('GET', '/v1/walls/state');
const artState = () => request<ArtRecord>('GET', `/v1/surfaces/instances/${surfaceInstanceId}`);
const liveState = () => request<{ sessions: { session: { sessionId: string }; sourceConnected: boolean; closed: boolean }[] }>('GET', '/v1/live/sessions');
const sourceState = () => sampleJson<{ frames: number }>(path.join(root, 'source-status.json'));
const fixtureState = () => sampleJson<{ clicks: number }>(path.join(root, 'fixture-state.json'));
const screenshots = path.resolve(root, '../../output/playwright', path.basename(root));
await mkdir(screenshots, { recursive: true });
const browser = await connectOutput(runtime.loomCdpPort);
let outputBrowser: Browser | undefined, page: Page | undefined;
const result: Record<string, unknown> = { passed: false, nativeTransport: true, executable: runtime.loomExe };
try {
    page = await until(async () => browser.contexts().flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith('http://tauri.localhost')), Boolean, 'packaged Loom management');
    assert(page); page.setDefaultTimeout(15000); await page.bringToFront();
    assert(await page.evaluate(() => '__TAURI_INTERNALS__' in window));
    outputBrowser = await connectOutput(runtime.outputCdpPort);
    const output = await until(async () => outputBrowser!.contexts().flatMap((context) => context.pages())
        .find((candidate) => candidate.url().endsWith('#tile-output')), Boolean, 'physical output');
    assert(output);
    const original = await until(wallState, (state) => state.endpoints.length === 1 && state.endpoints[0].online, 'registered output');
    assert.equal(original.layouts.length, 0, 'management starts from its own empty catalog');
    const ordinary = await artState(), liveBefore = await liveState();
    assert(ordinary.attachments[sourceAttachmentId]);
    const sourceBefore = await sourceState();
    await page.getByRole('button', { name: '设备管理', exact: true }).click();
    await page.getByRole('button', { name: '屏幕墙', exact: true }).click();
    const wall = page.getByRole('region', { name: '屏幕墙管理', exact: true });
    await wall.getByRole('button', { name: '创建墙面', exact: true }).click();
    const draft = wall.getByRole('region', { name: '墙面草稿', exact: true });
    await draft.getByLabel('墙面 ID', { exact: true }).fill('native-input-wall');
    await draft.getByLabel('添加已注册输出（排列在右侧）').selectOption(original.endpoints[0].endpoint.endpointId);
    const tile = draft.getByRole('region', { name: '排列瓷砖', exact: true }).locator('details').first();
    await geometry(tile.getByRole('group', { name: '瓷砖占地（旋转后的宽高）', exact: true }), { x: 0, y: 0, width: 300, height: 100 });
    await geometry(draft.getByRole('group', { name: '墙面范围（逻辑坐标）', exact: true }), { x: 0, y: 0, width: 300, height: 100 });
    await wall.getByRole('button', { name: '刷新内容来源', exact: true }).click();
    const content = draft.getByRole('region', { name: '放置内容', exact: true });
    const selection = content.getByLabel('已有内容');
    const rows = content.locator(':scope > details.wall-row');
    async function add(key: string, rect: WallRect) {
        await selection.selectOption(key);
        await content.getByRole('button', { name: '放置到墙面', exact: true }).click();
        const row = rows.last();
        await geometry(row.getByRole('group', { name: '墙面位置', exact: true }), rect);
        return row;
    }
    async function save() {
        const before = await wallState();
        await draft.getByRole('button', { name: '保存布局', exact: true }).click();
        const saved = await until(wallState, (state) => state.revision > before.revision
            && state.layouts.length === 1 && state.endpoints[0].appliedRevision === state.layouts[0].revision,
        'UI save and physical application', 35000);
        return saved.layouts[0];
    }
    const live = await add(`live:${source.sessionId}`, { x: 0, y: 0, width: 100, height: 100 });
    await live.getByRole('checkbox').check();
    await add(`surface:${surfaceInstanceId}`, { x: 100, y: 0, width: 100, height: 100 });
    const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#f02030'; context.fillRect(0, 0, 16, 16);
        context.fillStyle = '#2050f0'; context.fillRect(16, 0, 16, 16);
        return canvas.toDataURL('image/png').split(',')[1];
    });
    await content.locator('input[type=file]').setInputFiles({ name: 'wall-management.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    const imageKey = await until(() => selection.inputValue(), (key) => key.startsWith('image:sha256:'), 'imported image selection');
    await add(imageKey, { x: 200, y: 0, width: 100, height: 100 });
    const initial = await save();
    assert.deepEqual(initial.placements.map((placement) => placement.source.kind), ['live', 'surface', 'image']);
    assert.deepEqual(initial.placements.map((placement) => placement.rect.x), [0, 100, 200]);
    await output.locator(`[data-surface-unit-id="tile:${initial.placements[1].placementId}"]`).waitFor({ state: 'visible' });
    const canvas = await output.locator('canvas').first().boundingBox(); assert(canvas);
    const points = [0.75, 11 / 12].map((x) => ({ x: canvas.x + canvas.width * x, y: canvas.y + canvas.height / 2 }));
    const red = [240, 32, 48, 255], blue = [32, 80, 240, 255];
    assert.deepEqual(await screenshotPixels(output, points), [red, blue]);
    await output.screenshot({ path: path.join(screenshots, 'management-three-sources.png') });
    result.createdThroughUi = initial;

    const duplicateImage = await add(imageKey, { x: 200, y: 0, width: 100, height: 100 });
    await geometry(duplicateImage.getByRole('group', { name: '源裁剪（0 到 1）', exact: true }), { x: 0.5, y: 0, width: 0.5, height: 1 });
    await duplicateImage.getByLabel('层级（较大在上）', { exact: true }).fill('10');
    const cropped = await save();
    assert.equal(cropped.placements[2].source.id, cropped.placements[3].source.id);
    assert.deepEqual(cropped.placements[3].sourceCrop, { x: 0.5, y: 0, width: 0.5, height: 1 });
    assert.deepEqual(await screenshotPixels(output, points), [blue, blue]);
    await duplicateImage.getByLabel('层级（较大在上）', { exact: true }).fill('-1');
    await save(); assert.deepEqual(await screenshotPixels(output, points), [red, blue]);
    result.cropAndLayerPixels = true;
    await add(`live:${source.sessionId}`, { x: 25, y: 25, width: 50, height: 50 });
    const duplicated = await save();
    assert.equal(duplicated.placements.filter((placement) => placement.source.kind === 'live').length, 2);
    const liveAfter = await liveState();
    assert.deepEqual(liveAfter.sessions.map((record) => record.session.sessionId).sort(), liveBefore.sessions.map((record) => record.session.sessionId).sort());
    assert(liveAfter.sessions.some((record) => record.session.sessionId === source.sessionId && record.sourceConnected && !record.closed));
    assert((await sourceState()).frames > sourceBefore.frames);
    result.sameLiveSessionReused = true;
    await rows.last().getByRole('button', { name: '从草稿移除', exact: true }).click();
    await rows.last().getByRole('button', { name: '从草稿移除', exact: true }).click();
    await rows.nth(1).getByRole('button', { name: '从草稿移除', exact: true }).click();
    const reduced = await save();
    assert.deepEqual(reduced.placements.map((placement) => placement.source.kind), ['live', 'image']);
    const detached = await until(artState, (record) => Object.keys(record.attachments).length === Object.keys(ordinary.attachments).length, 'removed Art mirror cleanup');
    assert(detached.attachments[sourceAttachmentId]);
    assert.deepEqual(detached.latestResult, ordinary.latestResult);
    result.removingPlacementsPreservesSources = true;
    await add(`surface:${surfaceInstanceId}`, { x: 100, y: 0, width: 100, height: 100 });
    const final = await save();
    assert.equal(final.placements.find((placement) => placement.source.kind === 'surface')?.source.id, surfaceInstanceId);
    await until(() => draft.getByRole('status').allTextContents(),
        (messages) => messages.some((message) => message.includes('1 / 1 个输出已确认')), 'management shows output acknowledgement');
    await draft.getByLabel('墙面 ID', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshots, 'management-layout-editor.png') });
    result.finalManagedLayout = final;

    process.kill(runtime.loomPid);
    await output.bringToFront();
    const first = await frameSignature(output);
    await until(() => frameSignature(output), (value) => value !== first, 'mixed dynamic output without Loom UI');
    const beforeClick = await fixtureState(), [x, y] = (source.targets ?? fixture.targets).action;
    await output.mouse.click(canvas.x + canvas.width * x / 3, canvas.y + canvas.height * y);
    const clicked = await until(fixtureState, (state) => state.clicks > beforeClick.clicks, 'source input after Loom UI closes');
    assert.equal(clicked.clicks, beforeClick.clicks + 1);
    assert.equal((await wallState()).layouts[0].revision, final.revision);
    assert.deepEqual(await screenshotPixels(output, points), [red, blue]);
    await output.screenshot({ path: path.join(screenshots, 'management-headless.png') });
    result.headlessMixedDisplayAndInput = true; result.passed = true;
    await writeJson(path.join(root, 'management-result.json'), result);
} catch (error) {
    await writeJson(path.join(root, 'management-failure.json'), { result,
        error: error instanceof Error ? error.message : 'management probe failed',
        alerts: await page?.getByRole('alert').allTextContents().catch(() => []),
        selectLabels: await page?.getByRole('combobox').evaluateAll((elements) => elements.map((element) =>
            element instanceof HTMLSelectElement ? [...element.labels ?? []].map((label) => label.textContent?.slice(0,240)) : [])).catch(() => []) });
    await page?.screenshot({ path: path.join(screenshots, 'management-failure.png') }).catch(() => undefined);
    throw error;
} finally {
    await Promise.allSettled([browser.close(), outputBrowser?.close()]);
}

async function geometry(group: Locator, rect: WallRect) {
    for (const [key, label] of [['x', 'X'], ['y', 'Y'], ['width', '宽度'], ['height', '高度']] as const) {
        await group.getByLabel(label, { exact: true }).fill(String(rect[key]));
    }
}

async function frameSignature(page: Page) {
    return page.evaluate(() => {
        const canvas = document.querySelector('canvas')!;
        const bytes = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (let index = 0; index < bytes.length; index += 64) hash = Math.imul(hash ^ bytes[index], 16777619);
        return hash >>> 0;
    });
}
