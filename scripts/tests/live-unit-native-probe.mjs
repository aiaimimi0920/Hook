import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import assert from "node:assert/strict";

const [output, cdp, pointer] = process.argv.slice(2);
const exec = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const os = async (...args) => (await exec(pointer, args.map(String), { windowsHide: true })).stdout;
const json = async (name) => JSON.parse(await readFile(join(output, name), "utf8"));
const hwndValue = (value) => BigInt(`0x${value.replace(/^0x/, "")}`);
const waitFor = async (fn, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
        try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
        await sleep(100);
    }
    throw new Error(`Probe timeout: ${last?.message ?? fn.toString()}`);
};
const frontendRelease = process.env.HOOK_LIVE_FRONTEND_RELEASE_DIAGNOSTIC === "1";
const result = { passed: false, nativeSelectionAcceptance: !frontendRelease, steps: [], pointerTrace: [] };
let browser;
let page;
try {
    const ready = await waitFor(() => json("fixture-ready.json"));
    browser = await waitFor(() => chromium.connectOverCDP(cdp, { timeout: 1000 }));
    page = await waitFor(async () => {
        for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
            if (await candidate.evaluate(() => Boolean(window.__TAURI_INTERNALS__))) return candidate;
        }
    });
    await waitFor(async () => (await readFile(join(output, "logs/hook-runtime.log"), "utf8")).includes("frontend-initialized"));
    await page.evaluate(() => {
        window.__liveProbeEvents = [];
        for (const name of ["pointerdown", "pointermove", "pointerup", "mousedown", "mouseup"]) document.addEventListener(name, (event) => {
            if (window.__liveProbeEvents.length < 120) window.__liveProbeEvents.push({ name, target: event.target.className, x: event.clientX, y: event.clientY, trusted: event.isTrusted, buttons: event.buttons });
        }, true);
    });
    let viewport = await page.evaluate(() => ({ dpr: devicePixelRatio, x: screenX, y: screenY, w: innerWidth, h: innerHeight }));
    await os("show", ready.hwnd);
    await sleep(500);
    const client = JSON.parse(await os("client", ready.hwnd));
    const selected = { x: client.x + 8, y: client.y + 8, w: client.w - 16, h: client.h - 16 };
    const pointerAt = async (operation, x, y) => {
        const expected = { x: Math.round((x + viewport.x) * viewport.dpr), y: Math.round((y + viewport.y) * viewport.dpr) };
        const observed = JSON.parse(await os(operation, expected.x, expected.y));
        result.pointerTrace.push({ operation, expected, observed });
    };
    const move = (x, y) => pointerAt("move", x, y);
    const edge = (operation, point) => pointerAt(operation, point.x, point.y);
    const drag = async (from, to) => {
        await move(from.x, from.y); await sleep(180);
        await edge("down", from);
        await sleep(120);
        for (let step = 1; step <= 8; step++) {
            await move(from.x + (to.x - from.x) * step / 8, from.y + (to.y - from.y) * step / 8);
            await sleep(45);
        }
        await edge("up", to);
        await sleep(600);
    };
    await os("key", 17, 50); // The product Ctrl+2 global shortcut, not direct start IPC.
    await waitFor(async () => {
        const log = await readFile(join(output, "logs/hook-runtime.log"), "utf8");
        return log.includes("set_capture_input_active :: true") && log.includes("capture-window-targets-ready");
    });
    viewport = await page.evaluate(() => ({ dpr: devicePixelRatio, x: screenX, y: screenY, w: innerWidth, h: innerHeight }));
    result.viewport = viewport;
    result.fixtureTarget = (await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("list_capture_window_targets")))
        .find((target) => hwndValue(target.id) === hwndValue(ready.hwnd));
    assert(result.fixtureTarget, "The visible test fixture must be enumerated before selecting");
    const origin = { x: selected.x / viewport.dpr - viewport.x, y: selected.y / viewport.dpr - viewport.y };
    await drag(origin, { x: origin.x + selected.w / viewport.dpr, y: origin.y + selected.h / viewport.dpr });
    if (frontendRelease) {
        // Explicit diagnostic only: isolate controller/rendering from WH_MOUSE_LL.
        // Never enable this as a fallback in the native selection acceptance gate.
        const payload = {
            x: origin.x + selected.w / viewport.dpr, y: origin.y + selected.h / viewport.dpr,
            globalX: selected.x + selected.w, globalY: selected.y + selected.h,
            scaleFactor: viewport.dpr, physicalOriginX: viewport.x * viewport.dpr,
            physicalOriginY: viewport.y * viewport.dpr,
            ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, nativeDragPreflight: false,
        };
        await page.evaluate((payload) => window.__TAURI_INTERNALS__.invoke("plugin:event|emit", {
            event: "capture/global_mouse_up", payload,
        }), payload);
    }
    const live = page.locator(".unit-live-input").first();
    await live.waitFor({ timeout: 20000 });
    const id = await live.getAttribute("data-live-capture-session-id");
    result.capture = await page.evaluate((sessionId) => window.__TAURI_INTERNALS__.invoke("get_live_capture_status", { sessionId }), id);
    assert.equal(hwndValue(result.capture.sourceWindowId), hwndValue(ready.hwnd), "Never send input to any window other than the owned fixture");
    const unit = page.locator(`[data-unit-id="${id}"]`).first();
    const initial = await unit.boundingBox();
    result.selection = { client, selected, origin, initial };
    assert(initial, "Live must be rendered by UnitView");
    assert(Math.abs(initial.width - selected.w / viewport.dpr) <= 3, "Live initial DPI width changed");
    assert(Math.abs(initial.x - origin.x) <= 3 && Math.abs(initial.y - origin.y) <= 3, "Live must start at selection origin");
    result.steps.push({ step: frontendRelease ? "frontend-release-create-unit-dpi-position" : "ctrl2-create-unit-dpi-position", id, initial });
    await waitFor(() => unit.locator("[data-sticker-base-image]").evaluate((image) => image.complete && image.naturalWidth > 0), 15000);
    const gpuPreview = process.env.HOOK_LIVE_GPU_PREVIEW === "1";
    const waitGpuMirror = async () => {
        if (!gpuPreview) return;
        await waitFor(() => unit.locator("[data-sticker-base-image]").evaluate((image) => image.dataset.liveGpuPreview === "gpu-mirror"));
        result.steps.push({ step: "native-gpu-mirror-submitted", submitted: await unit.locator("[data-sticker-base-image]").getAttribute("data-live-gpu-submitted") });
    };
    await waitGpuMirror();

    const from = { x: initial.x + 2, y: initial.y + 2 };
    const to = { x: Math.min(viewport.w - initial.width - 10, from.x + 540), y: from.y + 50 };
    await drag(from, to);
    const moved = await unit.boundingBox();
    assert(Math.abs(moved.x - (initial.x + to.x - from.x)) <= 3, "Corner drag must move the shared Unit");
    await move(to.x + 90, to.y + 90); await sleep(900);
    const settled = await unit.boundingBox();
    assert(Math.abs(settled.x - moved.x) <= 1 && Math.abs(settled.y - moved.y) <= 1, "Drag must stop after release");
    result.steps.push({ step: "native-corner-drag-release", moved, settled });
    await waitGpuMirror();

    const action = {
        x: moved.x + (ready.targets.action[0] * client.w - 8) / viewport.dpr,
        y: moved.y + (ready.targets.action[1] * client.h - 8) / viewport.dpr,
    };
    const before = await json("fixture-state.json");
    await move(action.x, action.y); await sleep(180); await edge("down", action); await sleep(100); await edge("up", action);
    const clicked = await waitFor(async () => { const state = await json("fixture-state.json"); return state.clicks > before.clicks ? state : null; }, 5000);
    assert.equal(clicked.clicks, before.clicks + 1, "A Live click must produce exactly one source click");
    result.steps.push({ step: "native-live-source-button", before, after: clicked });
    await os("window", ready.hwnd, client.x + 120, client.y + 70); await sleep(600);
    await move(action.x, action.y); await edge("down", action); await sleep(100); await edge("up", action);
    const afterMove = await waitFor(async () => { const state = await json("fixture-state.json"); return state.clicks > clicked.clicks ? state : null; }, 5000);
    assert.equal(afterMove.clicks, clicked.clicks + 1);
    result.steps.push({ step: "source-move-preserves-region-and-input", state: afterMove });
    const track = {
        x: moved.x + (ready.targets.trackThumb[0] * client.w - 8) / viewport.dpr,
        y: moved.y + (ready.targets.trackThumb[1] * client.h - 8) / viewport.dpr,
    };
    await drag(track, { x: track.x + 65, y: track.y });
    result.nativeSliderState = await json("fixture-state.json");
    if (result.nativeSliderState.trackValue === before.trackValue) {
        await page.mouse.move(track.x, track.y); await page.mouse.down();
        await page.mouse.move(track.x + 65, track.y, { steps: 8 }); await page.mouse.up();
        await sleep(700);
        result.cdpSliderState = await json("fixture-state.json");
        throw new Error("Native slider did not move; compare native and CDP boundary evidence");
    }
    const trackChanged = await waitFor(async () => {
        const state = await json("fixture-state.json");
        return state.trackValue !== before.trackValue ? state : null;
    }, 5000);
    result.steps.push({ step: "source-slider-native-drag", state: trackChanged });
    await waitGpuMirror();
    const cadenceSample = async () => ({
        status: await page.evaluate((sessionId) => window.__TAURI_INTERNALS__.invoke("get_live_capture_status", { sessionId }), id),
        gpu: await unit.locator("[data-sticker-base-image]").evaluate((image) => ({
            submitted: Number(image.dataset.liveGpuSubmitted ?? 0), skipped: Number(image.dataset.liveGpuCpuSkipped ?? 0),
        })),
        process: JSON.parse(await os("process", id.split("-")[1])), at: performance.now(),
    });
    const cadenceStart = await cadenceSample();
    await sleep(6200); // Longer than the capture-health deadline: JPEG suppression must not cause recovery.
    const cadenceEnd = await cadenceSample();
    const encodedFrames = cadenceEnd.status.frameId - cadenceStart.status.frameId;
    const submittedFrames = cadenceEnd.gpu.submitted - cadenceStart.gpu.submitted;
    const skippedReadbacks = cadenceEnd.gpu.skipped - cadenceStart.gpu.skipped;
    assert.equal(cadenceEnd.status.captureState, "streaming");
    assert.equal(cadenceEnd.status.epoch, cadenceStart.status.epoch, "Healthy GPU capture must not time out without JPEG");
    if (gpuPreview) {
        assert(submittedFrames > 10 && skippedReadbacks > 10, "Native frames must advance while CPU readbacks are skipped");
        assert(encodedFrames < submittedFrames, "GPU must not keep encoding every presented frame");
    } else assert(encodedFrames > 10, "JPEG compatibility frames must continue updating");
    result.steps.push({ step: "live-cadence-cpu-sample", gpuPreview, encodedFrames, submittedFrames, skippedReadbacks,
        elapsedMs: cadenceEnd.at - cadenceStart.at,
        cpuSeconds: cadenceEnd.process.cpuSeconds - cadenceStart.process.cpuSeconds,
        before: cadenceStart, after: cadenceEnd });

    await os("key", 9);
    await page.locator(`[id="params-panel-${id}"]`).waitFor();
    result.steps.push({ step: "native-tab-params" });
    await os("key", 9);
    await waitGpuMirror();
    if (gpuPreview) {
        // Tauri's invoke property is read-only; observe a real IPC response,
        // never pretend that assigning an invoke wrapper instruments product calls.
        const snapshot = await page.evaluate(async (sessionId) => {
            const response = await window.__TAURI_INTERNALS__.invoke("read_live_gpu_snapshot", { sessionId });
            const bytes = response instanceof ArrayBuffer ? new Uint8Array(response) : response;
            return { byteLength: bytes?.byteLength ?? 0, signature: Array.from(bytes?.slice(8, 16) ?? []) };
        }, id);
        assert(snapshot.byteLength > 16, "Native GPU snapshot must contain pixels");
        assert.deepEqual(snapshot.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
        result.steps.push({ step: "native-gpu-snapshot-ipc", byteLength: snapshot.byteLength });
    }
    await os("key", 17, 69);
    await waitFor(async () => (await page.locator(".unit-live-input").count()) === 0, 5000);
    const toolbar = page.locator(`.fixed[data-hook-drag-follow-unit-id="${id}"]`);
    await toolbar.waitFor();
    result.steps.push({ step: "native-ctrl-e-shared-editor" });
    if (gpuPreview) {
        const src = await unit.locator("[data-sticker-base-image]").getAttribute("src");
        assert(/^data:image\/(png|jpeg);base64,/.test(src), "Editor must own pixels, not a streaming object URL");
        result.steps.push({ step: "native-ctrl-e-owned-snapshot", editorMime: src.slice(5, src.indexOf(";")) });
        await waitFor(() => unit.locator("[data-sticker-base-image]").evaluate((image) => image.dataset.liveGpuPreview === "jpeg"));
        result.steps.push({ step: "native-gpu-suspended-for-editor" });
    }
    await page.screenshot({ path: join(output, "editor.png") });
    await os("key", 17, 69);
    await live.waitFor();
    await os("key", 16, 49);
    await waitFor(async () => (await page.locator(`[id="actions-menu-${id}"]`).count()) > 0
        || (await page.locator("body").innerText()).includes("Add Art"), 5000);
    const loomEnabled = process.env.HOOK_ENABLE_LOOM_HOOK === "1";
    if (loomEnabled) {
        const addArt = page.locator(`[id="actions-menu-${id}"] [data-add-art-id]`).first();
        await addArt.waitFor();
        const box = await addArt.boundingBox();
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await move(point.x, point.y);
        await edge("down", point); await sleep(120); await edge("up", point);
        await waitFor(async () => (await page.locator("[data-unit-id]").count()) >= 2, 10000);
    }
    result.steps.push({ step: "native-shift1-add-art-route", loomEnabled, artCreated: loomEnabled });
    await page.screenshot({ path: join(output, "live-unit.png") });
    result.passed = true;
} catch (error) {
    result.error = error.stack;
    result.fixtureState = await json("fixture-state.json").catch(() => null);
    if (page) {
        result.gpuDiagnostic = await page.evaluate(async () => ({
            capability: await window.__TAURI_INTERNALS__.invoke("get_live_gpu_preview_capability"),
            invokeWritable: Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__, "invoke")?.writable,
            images: Array.from(document.querySelectorAll("[data-sticker-base-image]")).map((image) => ({
                dataset: { ...image.dataset }, natural: [image.naturalWidth, image.naturalHeight],
                complete: image.complete, rect: image.getBoundingClientRect().toJSON(),
                ancestors: [image, image.parentElement, image.closest(".sticker-visual"), image.closest(".unit-container")]
                    .map((element) => element ? { className: element.className,
                        opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform,
                        rect: element.getBoundingClientRect().toJSON() } : null),
                notices: image.closest(".unit-container")?.querySelector("[data-hook-unit-notice-layer]")?.textContent,
            })), visibility: document.visibilityState,
            scripts: Array.from(document.scripts).map((script) => script.src),
        })).catch(() => null);
        result.inputTrace = await page.evaluate(() => window.__liveProbeEvents ?? []);
        await page.screenshot({ path: join(output, "failure.png") }).catch(() => undefined);
        result.dom = await page.locator("body").innerText().catch(() => "");
    }
    process.exitCode = 1;
} finally {
    await os("up").catch(() => undefined);
    if (page) await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("request_native_acceptance_exit", { marker: "live-unit-probe-cleanup" })).catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
}
