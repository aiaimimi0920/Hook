import { chromium, type Browser, type Page } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

type Frame = { frameId: number; captureTimestampMs: number; encodeTimestampMs: number; byteLength: number };
type Sample = { frameId: number; at: number; ageMs: number; captureToEncodeMs: number };
type Tauri = { __TAURI_INTERNALS__: { invoke<T>(name: string, args: Record<string, unknown>): Promise<T> } };
const [output, cdp, , fpsArg] = process.argv.slice(2);
const targetFps = Number(fpsArg);
assert(targetFps >= 1 && targetFps <= 60);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async <T>(fn: () => Promise<T | undefined>): Promise<T> => {
    const end = Date.now() + 30000;
    let last: unknown;
    while (Date.now() < end) {
        try { const value = await fn(); if (value !== undefined) return value; } catch (error) { last = error; }
        await sleep(100);
    }
    throw new Error(`Probe readiness timeout: ${String(last)}`);
};
const result: Record<string, unknown> = { passed: false, targetFps };
let browser: Browser | undefined;
let page: Page | undefined;
try {
    const ready = await waitFor(async () => JSON.parse(await readFile(join(output, "fixture-ready.json"), "utf8")) as { hwnd: string });
    browser = await waitFor(() => chromium.connectOverCDP(cdp, { timeout: 1000 }));
    page = await waitFor(async () => {
        for (const candidate of browser!.contexts().flatMap((context) => context.pages())) {
            if (await candidate.evaluate(() => Boolean((window as unknown as Tauri).__TAURI_INTERNALS__))) return candidate;
        }
    });
    await waitFor(async () => (await readFile(join(output, "logs/hook-runtime.log"), "utf8")).includes("frontend-initialized") ? true : undefined);
    const samples = await page.evaluate(async ({ windowId, targetFps }) => {
        const invoke = <T>(name: string, args: Record<string, unknown>): Promise<T> =>
            (window as unknown as Tauri).__TAURI_INTERNALS__.invoke<T>(name, args);
        const samples: Sample[] = [];
        const status = await invoke<{ sessionId: string }>("start_live_capture", { request: {
            windowId, x: 20, y: 30, width: 680, height: 430, targetFps,
        } });
        const image = new Image();
        image.style.cssText = "position:fixed;left:20px;top:20px;width:680px;height:430px;object-fit:contain";
        document.body.append(image);
        const start = performance.now();
        let frameId = 0;
        let url: string | undefined;
        try {
            while (performance.now() - start < 9000) {
                const cycle = performance.now();
                const response = await invoke<{ frame?: Frame }>("poll_live_capture_frame", { sessionId: status.sessionId, afterFrameId: frameId });
                if (response.frame && response.frame.frameId > frameId) {
                    const frame = response.frame;
                    let nextUrl: string | undefined;
                    try {
                        const bytes = await invoke<ArrayBuffer>("read_live_capture_frame", { sessionId: status.sessionId, frameId: frame.frameId });
                        nextUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
                        const decoded = new Image(); decoded.src = nextUrl; await decoded.decode();
                        image.src = nextUrl;
                        if (url) URL.revokeObjectURL(url);
                        url = nextUrl; nextUrl = undefined;
                        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
                        frameId = frame.frameId;
                        if (performance.now() - start > 1000) samples.push({ frameId, at: Date.now(),
                            ageMs: Date.now() - frame.captureTimestampMs,
                            captureToEncodeMs: frame.encodeTimestampMs - frame.captureTimestampMs });
                    } catch (error) {
                        if (nextUrl) URL.revokeObjectURL(nextUrl);
                        if (!String(error).includes("evicted")) throw error;
                    }
                }
                await new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, 1000 / targetFps - (performance.now() - cycle))));
            }
            return samples;
        } finally {
            image.remove(); if (url) URL.revokeObjectURL(url);
            await invoke("stop_live_capture", { sessionId: status.sessionId });
        }
    }, { windowId: ready.hwnd, targetFps });
    assert(samples.length > 10, "too few presented frames");
    const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
    const gaps = samples.slice(1).map((sample, index) => sample.at - samples[index].at);
    Object.assign(result, { passed: true, presentedFrames: samples.length,
        presentedFps: (samples.length - 1) * 1000 / (samples.at(-1)!.at - samples[0].at),
        gapMedianMs: percentile(gaps, 0.5), gapP95Ms: percentile(gaps, 0.95), maxGapMs: Math.max(...gaps),
        ageMedianMs: percentile(samples.map((sample) => sample.ageMs), 0.5),
        ageP95Ms: percentile(samples.map((sample) => sample.ageMs), 0.95),
        captureToEncodeMedianMs: percentile(samples.map((sample) => sample.captureToEncodeMs), 0.5),
    });
    await writeFile(join(output, "frame-timings.json"), JSON.stringify(samples));
} catch (error) {
    result.error = error instanceof Error ? error.message : String(error); process.exitCode = 1;
} finally {
    if (page) await page.evaluate(() => (window as unknown as Tauri).__TAURI_INTERNALS__.invoke("request_native_acceptance_exit", { marker: "live-video-probe-cleanup" })).catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2));
}
