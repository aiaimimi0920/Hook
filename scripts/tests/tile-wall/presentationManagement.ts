import { hasTauriOrigin } from './probeOrigins.ts';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { WallStateSnapshot } from '../../../src/services/wallTypes.ts';
import { connectOutput } from './artProbe.ts';
import { until, writeJson, type ProbeRuntime } from './probeSession.ts';

export async function verifyPresentationManagement(root: string, runtime: ProbeRuntime, readWall: () => Promise<WallStateSnapshot>) {
    assert(runtime.loomCdpPort && runtime.loomPid && runtime.loomExe);
    const browser = await connectOutput(runtime.loomCdpPort);
    try {
        const page = await until(async () => browser.contexts().flatMap((context) => context.pages())
            .find((page) => hasTauriOrigin(page.url())), Boolean, 'packaged Loom management page');
        assert(page); page.setDefaultTimeout(15000); await page.bringToFront();
        assert(await page.evaluate(() => '__TAURI_INTERNALS__' in window), 'management must use native transport');
        await page.getByRole('button', { name: '设备管理', exact: true }).click();
        await page.getByRole('button', { name: '屏幕墙', exact: true }).click();
        const wall = page.getByRole('region', { name: '屏幕墙管理', exact: true });
        await wall.getByRole('button', { name: 'display-wall · 1 块', exact: true }).click();
        const controls = wall.getByRole('region', { name: '墙面显示控制', exact: true });
        const draft = wall.getByRole('region', { name: '墙面草稿', exact: true });
        const width = draft.getByRole('group', { name: '墙面范围（逻辑坐标）', exact: true }).getByLabel('宽度', { exact: true });
        const save = draft.getByRole('button', { name: '保存布局', exact: true });
        async function mode(button: string, expected: 'running' | 'frozen' | 'black', outcome = 'applied') {
            await controls.getByRole('button', { name: button, exact: true }).click();
            const state = await until(readWall, (state) => {
                const control = state.presentations?.find((control) => control.wallId === 'display-wall');
                const endpoint = state.endpoints[0];
                return expected === 'running' ? !control && endpoint.appliedRevision === state.layouts[0].revision
                    : control?.mode === expected && endpoint.presentation?.revision === control.revision
                        && endpoint.presentation.outcome === outcome;
            }, 'native management command and physical output report', 35000);
            const label = expected === 'running' ? '运行' : expected === 'frozen' ? '冻结' : '黑场';
            await until(() => controls.getByRole('status').innerText(), (text) => text.includes(`显示请求：${label}`)
                && text.includes(outcome === 'applied' ? '1 / 1' : '0 / 1'), 'management applied count', 15000);
            return state;
        }
        const original = await readWall(), originalWidth = await width.inputValue();
        await width.fill(String(Number(originalWidth) + 100));
        const frozen = await mode('冻结显示', 'frozen');
        assert.equal(await width.inputValue(), String(Number(originalWidth) + 100));
        assert((await draft.locator(':scope > .wall-toolbar').first().innerText())
            .includes(`草稿目录 v${original.revision} / 当前目录 v${frozen.revision}`));
        assert(await save.isDisabled());
        await draft.getByRole('alert').filter({ hasText: '草稿仍保留' }).waitFor({ state: 'visible' });
        const screenshots = path.resolve(root, '../../output/playwright', path.basename(root));
        const screenshot = path.join(screenshots, 'loom-management-frozen.png');
        await controls.scrollIntoViewIfNeeded(); await page.screenshot({ path: screenshot });
        await mode('黑场', 'black');
        await mode('冻结显示', 'frozen', 'frame_unavailable');
        await wall.getByText('无完整保留帧，保持黑场', { exact: false }).waitFor({ state: 'visible' });
        await mode('恢复显示', 'running');
        assert.equal(await width.inputValue(), String(Number(originalWidth) + 100));
        assert(await save.isDisabled());
        await wall.getByRole('button', { name: '重新载入目录', exact: true }).click();
        await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
        await wall.getByRole('button', { name: 'display-wall · 1 块', exact: true }).click();
        assert.equal(await width.inputValue(), originalWidth);
        const clean = await mode('冻结显示', 'frozen');
        assert((await draft.locator(':scope > .wall-toolbar').first().innerText())
            .includes(`草稿目录 v${clean.revision} / 当前目录 v${clean.revision}`));
        assert.equal(await draft.getByRole('alert').count(), 0);
        await mode('恢复显示', 'running');
        const result = { nativeTransport: true, actualOutputReports: true, dirtyDraftCasPreserved: true,
            cleanDraftRefreshed: true, missingFrameShown: true, screenshot, executable: runtime.loomExe };
        await writeJson(path.join(root, 'management-result.json'), result);
        process.kill(runtime.loomPid);
        return result;
    } catch (error) {
        const page = browser.contexts().flatMap((context) => context.pages())[0];
        if (page) {
            await writeJson(path.join(root, 'management-failure.json'), {
                buttons: await page.getByRole('button').allTextContents().catch(() => []),
                alerts: await page.getByRole('alert').allTextContents().catch(() => []),
            });
            await page.screenshot({ path: path.resolve(root, '../../output/playwright', path.basename(root), 'loom-management-failure.png') }).catch(() => {});
        }
        throw error;
    } finally { await browser.close(); }
}
