import { hasTauriOrigin } from './probeOrigins.ts';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { Page } from 'playwright';
import type { TileOutput } from '../../../src/services/tilePresenter.ts';
import type { WallStateSnapshot } from '../../../src/services/wallTypes.ts';
import { art, connectOutput, sourceSnapshot, type ArtRecord, type ArtSource } from './artProbe.ts';
import { openProbe, readJson, until, writeJson } from './probeSession.ts';

type IdentificationProbe = Awaited<ReturnType<typeof openProbe>> & { root: string; output: Page };

/** Drive the real manager before display-control tests close it. Only the selected output is used. */
export async function verifyIdentification({ root, output, runtime, request }: IdentificationProbe, source?: ArtSource) {
    assert(runtime.loomCdpPort && runtime.loomExe && runtime.outputPid);
    const readWall = () => request<WallStateSnapshot>('GET', '/v1/walls/state');
    const original = await readWall(), endpoint = original.endpoints[0].endpoint;
    const physical = (await readJson<TileOutput[]>(path.join(root, 'outputs.json')))
        .find((item) => item.outputId === endpoint.outputId);
    assert(physical && endpoint.display?.canIdentify);
    assert.equal(endpoint.display.name, physical.name);
    assert.deepEqual(endpoint.pixelSize, { width: physical.width, height: physical.height });
    assert.equal(original.layouts.length, source ? 1 : 0);
    const readForm = () => request<ArtRecord>('GET', `/v1/surfaces/instances/${source!.instanceId}`);
    const beforeForm = source ? await readForm() : undefined;
    const stage = source ? 'assigned' : 'unassigned';
    const screenshots = path.resolve(root, '../../output/playwright', path.basename(root));
    const browser = await connectOutput(runtime.loomCdpPort);
    let page: Page | undefined;
    try {
        page = await until(async () => browser.contexts().flatMap((context) => context.pages())
            .find((page) => hasTauriOrigin(page.url())), Boolean, 'identification manager');
        assert(page); page.setDefaultTimeout(10000); await page.bringToFront();
        assert(await page.evaluate(() => '__TAURI_INTERNALS__' in window), 'real native manager transport');
        const wall = page.getByRole('region', { name: '屏幕墙管理', exact: true });
        if (!await wall.isVisible()) {
            await page.getByRole('button', { name: '设备管理', exact: true }).click();
            await page.getByRole('button', { name: '屏幕墙', exact: true }).click();
        }
        const row = wall.locator(`[data-endpoint-id="${endpoint.endpointId}"]`);
        await row.getByText(physical.name, { exact: true }).waitFor({ state: 'visible' });
        const draft = wall.getByRole('region', { name: '墙面草稿', exact: true });
        const width = draft.getByRole('group', { name: '墙面范围（逻辑坐标）', exact: true }).getByLabel('宽度', { exact: true });
        let originalWidth = '';
        if (source) {
            await wall.getByRole('button', { name: 'display-wall · 1 块', exact: true }).click();
            originalWidth = await width.inputValue();
            await width.fill(String(Number(originalWidth) + 50));
        }
        await wall.getByRole('button', { name: '刷新内容来源', exact: true }).click();
        await wall.getByRole('button', { name: '刷新内容来源', exact: true }).waitFor({ state: 'visible' });
        assert.equal(await wall.locator(':scope > p.wall-warning').count(), 0, 'source inventory must recover without resetting the draft');
        if (source) {
            assert.equal(await width.inputValue(), String(Number(originalWidth) + 50));
            await draft.getByRole('combobox', { name: '已有内容', exact: true }).selectOption(`surface:${source.instanceId}`);
            assert(await draft.getByRole('button', { name: '放置到墙面', exact: true }).isEnabled());
        }
        const startedAt = performance.now();
        await row.getByRole('button', { name: '识别屏幕', exact: true }).click();
        await output.bringToFront();
        const accepted = await until(readWall, (state) => Boolean(state.endpoints[0]?.identification), 'identification accepted');
        const command = accepted.endpoints[0].identification!;
        assert.equal(accepted.revision, original.revision); assert.deepEqual(accepted.layouts, original.layouts);
        const repeated = await request<WallStateSnapshot>('POST', '/v1/walls/endpoints/identify', { endpointId: endpoint.endpointId });
        assert.equal(repeated.endpoints[0].identification?.requestId, command.requestId);
        assert(repeated.endpoints[0].identification!.remainingMs <= command.remainingMs);
        const marker = output.getByRole('dialog', { name: '识别物理屏幕', exact: true });
        await marker.waitFor({ state: 'visible' });
        assert.equal(await marker.getByRole('heading').innerText(), physical.name);
        assert((await marker.innerText()).includes(endpoint.outputId));
        await until(readWall, (state) => state.endpoints[0]?.identification?.requestId === command.requestId
            && state.endpoints[0].identification.applied, 'physical output identification acknowledgement');
        assert(await output.locator('.tile-output-content').evaluate((element) => (element as HTMLElement).inert));
        await output.keyboard.press('Tab');
        assert(await marker.getByRole('button').evaluate((button) => button === document.activeElement));
        const outputScreenshot = path.join(screenshots, `${stage}-identification.png`);
        await output.screenshot({ path: outputScreenshot });
        await until(() => row.getByRole('status').innerText(), (text) => text.includes('正在识别'), 'manager shows output acknowledgement');
        const managementScreenshot = path.join(screenshots, `${stage}-identification-management.png`);
        await page.screenshot({ path: managementScreenshot });
        if (source && beforeForm) {
            const field = art(output).locator('[data-surface-node-id="project_name"]');
            const box = await field.boundingBox(); assert(box);
            // Real mouse and keyboard events must not reach the covered Art field.
            await output.mouse.click(box.x + 3, box.y + 3);
            await output.keyboard.type('shielded');
            const afterForm = await readForm();
            assert.deepEqual(sourceSnapshot(afterForm, source).authoritativeState, sourceSnapshot(beforeForm, source).authoritativeState);
            assert.deepEqual(Object.keys(afterForm.attachments).sort(), Object.keys(beforeForm.attachments).sort());
            assert.deepEqual(Object.keys(afterForm.eventAcks).sort(), Object.keys(beforeForm.eventAcks).sort());
            assert.equal(afterForm.pendingEvents.length, 0);
        } else {
            await output.keyboard.press('Escape');
        }
        await marker.waitFor({ state: 'detached', timeout: 15000 });
        const clearedAt = performance.now();
        await until(readWall, (state) => !state.endpoints[0]?.identification, 'identification cleared');
        assert(!output.isClosed()); process.kill(runtime.outputPid, 0);
        const after = await readWall();
        assert(after.endpoints[0].online); assert.equal(after.revision, original.revision);
        assert.deepEqual(after.layouts, original.layouts);
        if (source) {
            // A polling/screenshot observer can be late; the controller's exact deadline has unit coverage.
            assert(clearedAt - startedAt < 15000, 'automatic marker expiry was not bounded');
            await until(readWall, (state) => state.endpoints[0]?.appliedRevision === state.layouts[0]?.revision, 'ordinary output resumed');
            await until(() => art(output).locator('[data-surface-node-id="project_name"]').isEnabled(), Boolean, 'Art input resumed');
            assert.equal(await width.inputValue(), String(Number(originalWidth) + 50));
            assert((await draft.locator(':scope > .wall-toolbar').first().innerText())
                .includes(`草稿目录 v${original.revision} / 当前目录 v${original.revision}`));
            assert(await draft.getByRole('button', { name: '保存布局', exact: true }).isEnabled());
            await page.bringToFront();
            await draft.getByRole('button', { name: '关闭编辑', exact: true }).click();
            await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
        }
        const result = { stage, nativeTransport: true, physicalName: physical.name, outputId: physical.outputId,
            outputReportObserved: true, repeatedRequestDidNotExtendDeadline: true, revisionsUnchanged: true, sourceRefreshWithoutDraftReset: true,
            inputShielded: Boolean(source), dirtyDraftCasPreserved: Boolean(source), temporaryViewsUnchanged: Boolean(source),
            escapeKeptOutputAlive: !source, automaticallyExpired: Boolean(source), observedClearMs: Math.round(clearedAt - startedAt),
            outputScreenshot, managementScreenshot, executable: runtime.loomExe };
        await writeJson(path.join(root, `${stage}-identification-result.json`), result);
        return result;
    } catch (error) {
        await writeJson(path.join(root, `${stage}-identification-failure.json`), {
            wall: await readWall().catch(() => null), alerts: await page?.getByRole('alert').allTextContents().catch(() => []),
        });
        await page?.screenshot({ path: path.join(screenshots, `${stage}-identification-management-failure.png`) }).catch(() => {});
        throw error;
    } finally { await browser.close(); }
}
