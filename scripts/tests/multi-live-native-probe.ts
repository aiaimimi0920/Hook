import { chromium, type Browser, type Page } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

type Ready = { hwnd: string; bounds: number[]; targets: { action: number[] } };
type Rect = { x: number; y: number; w: number; h: number };
type Status = { sessionId: string; sourceWindowState: string; interactionEnabled: boolean };
type Frame = { frameId: number; width: number; height: number; byteLength: number };
type TauriWindow = Window & { __TAURI_INTERNALS__: { invoke<T>(command: string, args: Record<string, unknown>): Promise<T> } };
const [output, cdp, helper] = process.argv.slice(2);
const exec = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const json = async <T>(name: string): Promise<T> => JSON.parse(await readFile(join(output, name), "utf8"));
const waitFor = async <T>(fn: () => Promise<T | undefined>, timeout = 30000): Promise<T> => {
    const end = Date.now() + timeout;
    let last: unknown;
    while (Date.now() < end) {
        try { const value = await fn(); if (value !== undefined) return value; } catch (error) { last = error; }
        await sleep(100);
    }
    throw new Error(`Probe timeout: ${String(last)}`);
};
const result: { passed: boolean; steps: unknown[]; error?: string; cleanup?: boolean } = { passed: false, steps: [] };
const active = new Set<string>();
let browser: Browser | undefined;
let page: Page | undefined;
const invoke = <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
    assert(page);
    return page.evaluate(([command, args]) => (window as unknown as TauriWindow).__TAURI_INTERNALS__.invoke<T>(command, args), [command, args] as const);
};
try {
    const ready = await waitFor(() => json<Ready>("fixture-ready.json"));
    const other = await waitFor(() => json<Ready>("second-ready.json"));
    assert.notEqual(ready.hwnd, other.hwnd);
    browser = await waitFor(() => chromium.connectOverCDP(cdp, { timeout: 1000 }));
    page = await waitFor(async () => {
        for (const candidate of browser!.contexts().flatMap((context) => context.pages())) {
            if (await candidate.evaluate(() => Boolean((window as unknown as TauriWindow).__TAURI_INTERNALS__))) return candidate;
        }
    });
    await waitFor(async () => (await readFile(join(output, "logs/hook-runtime.log"), "utf8")).includes("frontend-initialized") ? true : undefined);
    assert.equal(await page.locator(".hook-live-relay-panel").count(), 0);
    result.steps.push({ globalLiveBadgeAbsent: true });
    const dpr = await page.evaluate(() => devicePixelRatio);
    const nativeScale = await invoke<number>("plugin:window|scale_factor");
    result.steps.push({ dpr, nativeScale });
    const captures: { id: string; source: Ready; crop: Rect; client: Rect; sequence: number }[] = [];
    for (const [index, source] of [ready, ready, other].entries()) {
        // The helper's only operation is a read-only client-bounds query; no OS mouse/key injection.
        const client: Rect = JSON.parse((await exec(helper, ["client", source.hwnd], { windowsHide: true })).stdout);
        const inset = index === 1 ? 8 : 0;
        const crop = { x: client.x - source.bounds[0] + inset, y: client.y - source.bounds[1] + inset,
            w: Math.floor(client.w * (index === 1 ? 0.75 : 0.6)), h: Math.floor(client.h * 0.8) };
        // Integral logical edges keep JSON float round trips out of this multi-session test.
        const windowRegion = { x: Math.ceil(crop.x / dpr), y: Math.ceil(crop.y / dpr),
            width: Math.floor(crop.w / dpr), height: Math.floor(crop.h / dpr) };
        const status = await invoke<Status>("start_live_capture", { request: {
            windowId: source.hwnd, x: 20, y: 30, width: Math.round(crop.w / dpr), height: Math.round(crop.h / dpr),
            windowRegion, targetFps: 12,
        } });
        active.add(status.sessionId);
        // Match the native outward-rounded physical pixel bounds at fractional DPI.
        crop.x = Math.floor(windowRegion.x * nativeScale);
        crop.y = Math.floor(windowRegion.y * nativeScale);
        crop.w = Math.ceil((windowRegion.x + windowRegion.width) * nativeScale) - crop.x;
        crop.h = Math.ceil((windowRegion.y + windowRegion.height) * nativeScale) - crop.y;
        captures.push({ id: status.sessionId, source, crop, client, sequence: 0 });
        await invoke("set_live_capture_interaction_enabled", { sessionId: status.sessionId, enabled: true });
    }
    assert.equal(active.size, 3);
    const readFrame = async (capture: typeof captures[number], afterFrameId = 0) => {
        const frame = await waitFor(async () => {
            const poll = await invoke<{ frame?: Frame }>("poll_live_capture_frame", { sessionId: capture.id, afterFrameId });
            return poll.frame && poll.frame.frameId > afterFrameId ? poll.frame : undefined;
        });
        // CDP does not serialize ArrayBuffer contents; convert inside the WebView first.
        const bytes = await page!.evaluate(async (args) => {
            const bytes = await (window as unknown as TauriWindow).__TAURI_INTERNALS__
                .invoke<ArrayBuffer>("read_live_capture_frame", args);
            return Array.from(new Uint8Array(bytes));
        }, { sessionId: capture.id, frameId: frame.frameId });
        const buffer = Buffer.from(bytes);
        assert.equal(buffer.length, frame.byteLength);
        assert(buffer.length > 100);
        assert.equal(frame.width, capture.crop.w, `crop width for ${capture.id}`);
        assert.equal(frame.height, capture.crop.h, `crop height for ${capture.id}`);
        return { ...frame, sha256: createHash("sha256").update(buffer).digest("hex") };
    };
    const frames: (Frame & { sha256: string })[] = [];
    for (const capture of captures) frames.push(await readFrame(capture));
    result.steps.push({ threeIndependentCrops: frames, dpr });
    await invoke("stop_live_capture", { sessionId: captures[1].id });
    active.delete(captures[1].id);
    for (const index of [0, 2]) {
        const capture = captures[index];
        const frame = await waitFor(async () => {
            const frame = await readFrame(capture, frames[index].frameId);
            return frame.sha256 !== frames[index].sha256 ? frame : undefined;
        });
        const stateFile = index === 0 ? "fixture-state.json" : "second-state.json";
        const before = (await json<{ clicks: number }>(stateFile)).clicks;
        const x = capture.client.x - capture.source.bounds[0] + capture.source.targets.action[0] * capture.client.w;
        const y = capture.client.y - capture.source.bounds[1] + capture.source.targets.action[1] * capture.client.h;
        for (const kind of ["mouse_move", "mouse_button_down", "mouse_button_up"]) {
            result.steps.push({ survivor: index, input: kind, delivery: "sending" });
            await invoke("send_live_capture_input", { sessionId: capture.id, request: {
                kind, sequence: ++capture.sequence, button: "left",
                normalizedX: (x - capture.crop.x) / (capture.crop.w - 1), normalizedY: (y - capture.crop.y) / (capture.crop.h - 1),
            } });
            result.steps.push({ survivor: index, input: kind, delivery: "completed" });
            await sleep(120);
        }
        await waitFor(async () => (await json<{ clicks: number }>(stateFile)).clicks === before + 1 ? true : undefined);
        result.steps.push({ survivor: index, newerFrame: frame, buttonClicks: [before, before + 1] });
    }
    // Explicit unhide is window-wide; stopping a session, in contrast, only releases its lease.
    await invoke("set_live_capture_source_hidden", { sessionId: captures[0].id, hidden: true });
    await invoke("set_live_capture_source_hidden", { sessionId: captures[0].id, hidden: false });
    assert.equal((await invoke<Status>("get_live_capture_status", { sessionId: captures[0].id })).sourceWindowState, "visible");
    result.passed = true;
} catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
} finally {
    const cleanup = await Promise.allSettled([...active].map((sessionId) => invoke("stop_live_capture", { sessionId })));
    result.cleanup = cleanup.every((entry) => entry.status === "fulfilled");
    if (!result.cleanup) { result.passed = false; process.exitCode = 1; }
    if (page) await invoke("request_native_acceptance_exit", { marker: "multi-live-probe-cleanup" }).catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2));
}
