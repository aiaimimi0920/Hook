import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Page } from 'playwright';
import type { LiveCaptureStatus } from '../../../src/services/liveCapture.ts';
import { readJson, until } from './probeSession.ts';

export async function sourceInvoke<T>(page: Page, command: string, args: Record<string, unknown> = {}): Promise<T> {
    return page.evaluate(({ command, args }) => (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
    }).__TAURI_INTERNALS__.invoke(command, args), { command, args }) as Promise<T>;
}

/** Real global shortcut and OS pointer selection; no direct capture-start or synthetic release. */
export async function captureGuiSource(page: Page, root: string, pointerExe: string) {
    const exec = promisify(execFile);
    const os = async (...args: (string | number)[]) => (await exec(pointerExe, args.map(String), {
        windowsHide: true, timeout: 10000, maxBuffer: 8192,
    })).stdout;
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const fixture = await readJson<{ hwnd: string; targets: Record<string, [number, number]> }>(path.join(root, 'fixture-ready.json'));
    const log = () => readFile(path.join(root, 'source-logs/hook-runtime.log'), 'utf8').catch(() => '');
    await until(log, (value) => value.includes('frontend-initialized'), 'ordinary Hook frontend initialized', 35000);
    await os('show', fixture.hwnd); await pause(500);
    const client = JSON.parse(await os('client', fixture.hwnd)) as { x: number; y: number; w: number; h: number };
    const selected = { x: client.x + 8, y: client.y + 8, w: client.w - 16, h: client.h - 16 };
    await os('key', 17, 50);
    await until(log, (value) => value.includes('set_capture_input_active :: true')
        && value.includes('capture-window-targets-ready'), 'native Ctrl+2 capture readiness');
    const targets = await sourceInvoke<{ id: string }[]>(page, 'list_capture_window_targets');
    const hwnd = (value: string) => BigInt(`0x${value.replace(/^0x/, '')}`);
    assert(targets.some((target) => hwnd(target.id) === hwnd(fixture.hwnd)), 'owned source must be enumerated');
    const pointerTrace: unknown[] = [];
    const pointer = async (operation: string, x: number, y: number) => {
        const expected = { x: Math.round(x), y: Math.round(y) };
        pointerTrace.push({ operation, expected, observed: JSON.parse(await os(operation, expected.x, expected.y)) });
    };
    let held = false;
    try {
        await pointer('move', selected.x, selected.y); await pause(180);
        held = true; await pointer('down', selected.x, selected.y); await pause(120);
        for (let step = 1; step <= 8; step++) {
            await pointer('move', selected.x + selected.w * step / 8, selected.y + selected.h * step / 8);
            await pause(45);
        }
        await pointer('up', selected.x + selected.w, selected.y + selected.h); held = false;
    } finally { if (held) await os('up'); }
    const live = page.locator('.unit-live-input').first();
    await live.waitFor({ state: 'visible', timeout: 20000 });
    const id = await live.getAttribute('data-live-capture-session-id'); assert(id);
    const capture = await until(() => sourceInvoke<LiveCaptureStatus>(page, 'get_live_capture_status', { sessionId: id }),
        (status) => status.captureState === 'streaming' && status.frameId > 0, 'ordinary GUI WGC streaming');
    assert(capture.sourceWindowId);
    assert.equal(hwnd(capture.sourceWindowId), hwnd(fixture.hwnd), 'only the owned fixture may receive source input');
    assert.equal(capture.sourceKind, 'window'); assert.equal(capture.inputCapability, 'window_message');
    const viewport = await page.evaluate(() => ({ dpr: devicePixelRatio, x: screenX, y: screenY }));
    const rect = await page.locator(`[data-unit-id="${id}"]`).first().boundingBox(); assert(rect);
    assert(Math.abs(rect.width - selected.w / viewport.dpr) <= 3);
    assert(Math.abs(rect.x - (selected.x / viewport.dpr - viewport.x)) <= 3);
    assert(Math.abs(rect.y - (selected.y / viewport.dpr - viewport.y)) <= 3);
    const sourceTargets = Object.fromEntries(Object.entries(fixture.targets).map(([key, [x, y]]) =>
        [key, [(x * client.w - 8) / selected.w, (y * client.h - 8) / selected.h]]));
    return { capture, sourceTargets, client, selected, viewport, rect, pointerTrace, nativeSelection: true };
}
