// Explicit frontend workload fixture, never a native selection/input acceptance.
import { chromium, type Browser, type Page, type Locator } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import assert from "node:assert/strict";

type Tauri = { __TAURI_INTERNALS__: { invoke: (name: string, args?: Record<string, unknown>) => Promise<unknown> } };
type Ready = { hwnd: string };
type Client = { x: number; y: number; w: number; h: number };
type Target = { id: string; x: number; y: number; w: number; h: number };
const [output, cdp, pointer] = process.argv.slice(2);
const count = Number(process.env.HOOK_LIVE_FRONTEND_BENCHMARK_COUNT);
assert([1, 2, 4, 6].includes(count));
const exec = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const os = async (...args: string[]) => (await exec(pointer, args, { windowsHide: true })).stdout;
async function waitFor<T>(check: () => Promise<T | undefined>, timeout = 20000): Promise<T> {
    const until = Date.now() + timeout;
    let last: unknown;
    while (Date.now() < until) {
        try { const value = await check(); if (value !== undefined) return value; } catch (error) { last = error; }
        await sleep(100);
    }
    throw new Error(`Frontend workload timeout: ${String(last)}`);
}
let browser: Browser | undefined;
let page: Page | undefined;
const sessions: string[] = [];
const result: Record<string, unknown> = { passed: false, nativeSelectionAcceptance: false, count };
result.sessions = sessions;
const selectionTargets: unknown[] = [];
result.selectionTargets = selectionTargets;
async function invoke<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    assert(page);
    return page.evaluate(({ name, args }) => (window as unknown as Tauri).__TAURI_INTERNALS__.invoke(name, args), { name, args }) as Promise<T>;
}
try {
    const ready = await waitFor(async () => JSON.parse(await readFile(join(output, "fixture-ready.json"), "utf8")) as Ready);
    browser = await waitFor(() => chromium.connectOverCDP(cdp, { timeout: 1000 }));
    page = await waitFor(async () => {
        for (const candidate of browser!.contexts().flatMap((context) => context.pages())) {
            if (await candidate.evaluate(() => Boolean((window as unknown as Tauri).__TAURI_INTERNALS__))) return candidate;
        }
    });
    await waitFor(async () => (await readFile(join(output, "logs/hook-runtime.log"), "utf8")).includes("frontend-initialized") ? true : undefined);
    await os("show", ready.hwnd);
    const client = JSON.parse(await os("client", ready.hwnd)) as Client;
    // Use one common left-edge source anchor, rather than starting later tiles
    // inside an overlapping window. Keep total area divisible for every count.
    const columns = 1;
    const rows = count;
    const width = Math.floor((client.w - 24) / 6) * 6;
    const height = Math.floor((client.h - 24) / 12) * 12;
    result.totalCropPhysicalPixels = width * height;
    for (let i = 0; i < count; i++) {
        await os("show", ready.hwnd);
        await sleep(150);
        const readyCount = async () => (await readFile(join(output, "logs/hook-runtime.log"), "utf8")).split("capture-window-targets-ready").length;
        const previousReady = await readyCount();
        await invoke("plugin:event|emit", { event: "trigger-live-capture", payload: null });
        await waitFor(async () => await readyCount() > previousReady ? true : undefined);
        const viewport: { dpr: number; x: number; y: number } = await page.evaluate(() => ({ dpr: devicePixelRatio, x: screenX, y: screenY }));
        const currentClient = JSON.parse(await os("client", ready.hwnd)) as Client;
        assert.equal(currentClient.w, client.w); assert.equal(currentClient.h, client.h);
        const x = currentClient.x + 12 + i % columns * width / columns;
        const y = currentClient.y + 12 + Math.floor(i / columns) * height / rows;
        const localX: number = x / viewport.dpr - viewport.x, localY: number = y / viewport.dpr - viewport.y;
        const targets = await invoke<Target[]>("list_capture_window_targets");
        const candidates: Target[] = targets.filter((t) =>
            localX >= t.x && localY >= t.y && localX < t.x + t.w && localY < t.y + t.h
        ).map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
        selectionTargets.push({ currentClient, localX, localY, candidates });
        assert.equal(candidates[0]?.id.toLowerCase(), ready.hwnd.replace(/^0x/, "").toLowerCase(),
            "Owned fixture is occluded in source hit-test order; refuse another application's capture");
        const emit = (event: string, globalX: number, globalY: number) => invoke("plugin:event|emit", {
            event, payload: {
                x: globalX / viewport.dpr - viewport.x, y: globalY / viewport.dpr - viewport.y,
                globalX, globalY, scaleFactor: viewport.dpr,
                physicalOriginX: viewport.x * viewport.dpr, physicalOriginY: viewport.y * viewport.dpr,
                ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, nativeDragPreflight: false,
            },
        });
        await emit("capture/global_mouse_down", x, y);
        await sleep(100);
        await emit("capture/global_mouse_move", x + width / columns, y + height / rows);
        await sleep(100);
        await emit("capture/global_mouse_up", x + width / columns, y + height / rows);
        const unit: Locator = page.locator(".unit-live-input").nth(i);
        await unit.waitFor({ timeout: 15000 });
        const sessionId: string | null = await unit.getAttribute("data-live-capture-session-id");
        assert(sessionId);
        sessions.push(sessionId);
        const status: { sourceWindowId: string } = await invoke("get_live_capture_status", { sessionId });
        assert.equal(BigInt(`0x${status.sourceWindowId.replace(/^0x/, "")}`), BigInt(`0x${ready.hwnd.replace(/^0x/, "")}`));
    }
    result.sessions = sessions;
    await waitFor(async () => {
        const active = await page!.locator('[data-live-gpu-preview="gpu-mirror"]').count();
        return active === count ? true : undefined;
    });
    const counters = () => page!.locator('[data-live-gpu-preview="gpu-mirror"]').evaluateAll((images) => images.map((image) => Number(image.getAttribute("data-live-gpu-submitted"))));
    const before = await counters();
    const started = performance.now();
    const raf = await page.evaluate(() => new Promise<number[]>((resolve) => {
        const gaps: number[] = [];
        const started = performance.now();
        let previous = started;
        const tick = (now: number) => {
            gaps.push(now - previous); previous = now;
            if (now - started >= 5000) resolve(gaps); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }));
    const after = await counters();
    result.elapsedMs = performance.now() - started;
    result.submittedDelta = after.map((value, i) => value - before[i]);
    result.rafGapsMs = raf;
    result.resources = await invoke("get_live_resource_status");
    assert(after.every((value, i) => value > before[i]), "Each real frontend Unit must continue presenting");
    assert.equal(await page.locator(".unit-live-input").count(), count);
    result.passed = true;
} catch (error) {
    result.error = String(error);
    if (page) {
        result.dom = await page.locator("body").innerText().catch(() => "");
        result.previewGeometry = await page.locator("[data-sticker-base-image]").evaluateAll((images) => images.map((element) => {
            const image = element as HTMLImageElement;
            const rect = image.getBoundingClientRect();
            const style = getComputedStyle(image);
            return { rect: rect.toJSON(), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
                objectFit: style.objectFit, transform: style.transform, state: image.dataset.liveGpuPreview,
                submitted: image.dataset.liveGpuSubmitted, error: image.dataset.liveGpuError };
        })).catch(() => []);
        await page.screenshot({ path: join(output, "failure.png") }).catch(() => undefined);
    }
    process.exitCode = 1;
} finally {
    const cleanup = await Promise.allSettled(sessions.map((sessionId) => invoke("stop_live_capture", { sessionId })));
    result.cleanup = cleanup;
    if (cleanup.some((entry) => entry.status === "rejected")) { result.passed = false; process.exitCode = 1; }
    if (page) {
        try {
            result.resourceCleanup = await waitFor(async () => {
                const status = await invoke<{ activeSources: number; sharedWindowCapturePools: number }>("get_live_resource_status");
                return status.activeSources === 0 && status.sharedWindowCapturePools === 0 ? status : undefined;
            });
        } catch (error) { result.cleanupError = String(error); result.passed = false; process.exitCode = 1; }
    }
    if (page) await invoke("request_native_acceptance_exit", { marker: "frontend-workload-cleanup" }).catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2), "utf8");
}
