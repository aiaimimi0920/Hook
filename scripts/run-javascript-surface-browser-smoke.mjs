/* global MessageChannel, fetch, window */

import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfig = JSON.parse(await fs.readFile(
    path.join(root, "src-tauri", "tauri.conf.json"),
    "utf8",
));
const tauriCsp = tauriConfig?.app?.security?.csp;
if (typeof tauriCsp !== "string" || tauriCsp.length === 0) {
    throw new Error("Hook Tauri CSP is missing");
}
const outputPath = path.resolve(
    root,
    process.env.HOOK_JAVASCRIPT_SURFACE_SMOKE_OUTPUT
        || "artifacts/runtime-performance/javascript-surface-browser.json",
);

const publicAssets = new Map([
    ["/javascript-surface-host.html", ["javascript-surface-host.html", "text/html; charset=utf-8"]],
    ["/javascript-surface-bootstrap.js", ["javascript-surface-bootstrap.js", "text/javascript; charset=utf-8"]],
]);
const server = http.createServer(async (request, response) => {
    try {
        const requestPath = new URL(request.url || "/", "http://127.0.0.1").pathname;
        response.setHeader("Content-Security-Policy", tauriCsp);
        if (requestPath === "/__javascript-surface-smoke") {
            response.statusCode = 200;
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end("<!doctype html><html><body></body></html>");
            return;
        }
        const asset = publicAssets.get(requestPath);
        if (!asset) {
            response.statusCode = 404;
            response.end("Not found");
            return;
        }
        const [assetName, contentType] = asset;
        const body = await fs.readFile(path.join(root, "public", assetName));
        response.statusCode = 200;
        response.setHeader("Content-Type", contentType);
        response.setHeader("Content-Length", String(body.byteLength));
        response.end(body);
    } catch (error) {
        response.statusCode = 500;
        response.end(String(error));
    }
});

let browser;
try {
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Vite test server did not bind TCP");
    const harnessUrl = `http://127.0.0.1:${address.port}/__javascript-surface-smoke`;
    const surfaceHostUrl = `http://127.0.0.1:${address.port}/javascript-surface-host.html`;
    const bootstrapUrl = `http://127.0.0.1:${address.port}/javascript-surface-bootstrap.js`;
    for (const url of [surfaceHostUrl, bootstrapUrl]) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`JavaScript Surface asset returned ${response.status}: ${url}`);
        await response.arrayBuffer();
    }

    browser = await chromium.launch({
        headless: true,
        args: ["--enable-precise-memory-info"],
    });
    const page = await browser.newPage({ deviceScaleFactor: 1.5 });
    const browserEvents = [];
    page.on("console", (message) => browserEvents.push({
        type: "console",
        level: message.type(),
        text: message.text(),
        location: message.location(),
    }));
    page.on("pageerror", (error) => browserEvents.push({ type: "pageerror", text: String(error) }));
    page.on("requestfailed", (request) => browserEvents.push({
        type: "requestfailed",
        url: request.url(),
        failure: request.failure(),
    }));
    const harnessResponse = await page.goto(harnessUrl, { waitUntil: "domcontentloaded" });
    if (!harnessResponse?.ok()) {
        throw new Error(`JavaScript Surface harness returned ${harnessResponse?.status()}`);
    }
    const snapshot = {
        protocolVersion: "loom.surface.v1",
        instanceId: "instance:browser-smoke",
        attachmentId: "attachment:browser-smoke",
        artId: "NA20260811004",
        artVersion: "1.0.0",
        revision: 1,
        runtime: "javascript",
        scene: { id: "root", type: "column" },
        authoritativeState: {},
    };

    const runScenario = async (name, source, expectedFailure) => {
        browserEvents.length = 0;
        const entryBase64 = Buffer.from(source, "utf8").toString("base64");
        const result = await page.evaluate(
            async ({ surfaceHostUrl, entryBase64, snapshot, expectedFailure }) => {
                const iframe = window.document.createElement("iframe");
                iframe.setAttribute("sandbox", "allow-scripts");

                const messages = [];
                const token = "surface-token-browser-smoke";
                const outcome = await new Promise((resolve) => {
                    const timeout = window.setTimeout(() => {
                        resolve({ kind: "timeout" });
                    }, 30_000);
                    iframe.addEventListener("load", () => {
                        const channel = new MessageChannel();
                        channel.port1.onmessage = (event) => {
                            messages.push(event.data);
                            const message = event.data;
                            if (message?.type === "failure") {
                                window.clearTimeout(timeout);
                                channel.port1.close();
                                resolve({ kind: "failure", message: String(message.message || "") });
                            } else if (!expectedFailure && message?.type === "heartbeat") {
                                channel.port1.postMessage({ type: "dispose", token });
                                window.clearTimeout(timeout);
                                channel.port1.close();
                                resolve({ kind: "heartbeat", budget: message.budget });
                            }
                        };
                        channel.port1.start();
                        iframe.contentWindow.postMessage({
                            type: "surface:init",
                            token,
                            entryBase64,
                            snapshot,
                            resources: {},
                        }, "*", [channel.port2]);
                    }, { once: true });
                    iframe.src = surfaceHostUrl;
                    window.document.body.replaceChildren(iframe);
                });
                iframe.remove();
                return { outcome, messageTypes: messages.map((message) => message?.type) };
            },
            { surfaceHostUrl, entryBase64, snapshot, expectedFailure },
        );

        result.frameUrls = page.frames().map((frame) => frame.url());
        result.browserEvents = [...browserEvents];
        if (expectedFailure) {
            if (result.outcome.kind !== "failure" || !result.outcome.message.includes(expectedFailure)) {
                throw new Error(`${name} did not fail with ${expectedFailure}: ${JSON.stringify(result)}`);
            }
        } else {
            if (result.outcome.kind !== "heartbeat") {
                throw new Error(`${name} did not publish a healthy heartbeat: ${JSON.stringify(result)}`);
            }
            const budget = result.outcome.budget;
            if (!budget?.capabilities?.heap || !budget?.capabilities?.longTask) {
                throw new Error(`${name} did not expose Chromium heap/long-task telemetry: ${JSON.stringify(budget)}`);
            }
        }
        return { name, expectedFailure: expectedFailure || null, ...result };
    };

    // init 监听器过去注册成 { once: true }，而 once 在监听器被“调用”时就摘掉它，不是在它
    // 成功时。于是任何早到一步的 message 都会把这唯一一次机会用掉，此后 surface 永远起不来。
    // 这个场景先塞两条本该被忽略的消息——类型不对的，以及形状对但没带 MessagePort 的——
    // 再发真正的 init，然后要求心跳照旧出现。
    const runStrayMessageScenario = async () => {
        browserEvents.length = 0;
        const source = "NeuroSurface.define({ mount({ root }) { root.textContent = 'ready'; } });";
        const entryBase64 = Buffer.from(source, "utf8").toString("base64");
        const result = await page.evaluate(
            async ({ surfaceHostUrl, entryBase64, snapshot }) => {
                const iframe = window.document.createElement("iframe");
                iframe.setAttribute("sandbox", "allow-scripts");

                const messages = [];
                const token = "surface-token-stray-message";
                const outcome = await new Promise((resolve) => {
                    const timeout = window.setTimeout(() => {
                        resolve({ kind: "timeout" });
                    }, 30_000);
                    iframe.addEventListener("load", () => {
                        const channel = new MessageChannel();
                        channel.port1.onmessage = (event) => {
                            messages.push(event.data);
                            const message = event.data;
                            if (message?.type === "failure") {
                                window.clearTimeout(timeout);
                                channel.port1.close();
                                resolve({ kind: "failure", message: String(message.message || "") });
                            } else if (message?.type === "heartbeat") {
                                channel.port1.postMessage({ type: "dispose", token });
                                window.clearTimeout(timeout);
                                channel.port1.close();
                                resolve({ kind: "heartbeat", budget: message.budget });
                            }
                        };
                        channel.port1.start();
                        iframe.contentWindow.postMessage({ type: "surface:stray" }, "*");
                        iframe.contentWindow.postMessage({
                            type: "surface:init",
                            token,
                            entryBase64,
                            snapshot,
                            resources: {},
                        }, "*");
                        iframe.contentWindow.postMessage({
                            type: "surface:init",
                            token,
                            entryBase64,
                            snapshot,
                            resources: {},
                        }, "*", [channel.port2]);
                    }, { once: true });
                    iframe.src = surfaceHostUrl;
                    window.document.body.replaceChildren(iframe);
                });
                iframe.remove();
                return { outcome, messageTypes: messages.map((message) => message?.type) };
            },
            { surfaceHostUrl, entryBase64, snapshot },
        );

        result.frameUrls = page.frames().map((frame) => frame.url());
        result.browserEvents = [...browserEvents];
        if (result.outcome.kind !== "heartbeat") {
            throw new Error(`stray-message did not survive a pre-init message: ${JSON.stringify(result)}`);
        }
        return { name: "stray-message", expectedFailure: null, ...result };
    };

    const runPointerRoutingScenario = async () => {
        browserEvents.length = 0;
        const source = `NeuroSurface.define({
            mount({ root, emit }) {
                root.innerHTML = '<input id="symbol" value="SZ000034"><button id="refresh" type="button">Refresh</button><canvas id="chart" width="240" height="120"></canvas>';
                let refreshClicks = 0;
                root.querySelector('#symbol').addEventListener('keydown', (event) => {
                    if (event.key !== 'Escape' || event.currentTarget.dataset.consumeEscape !== 'true') return;
                    event.preventDefault();
                    event.stopPropagation();
                });
                root.querySelector('#refresh').addEventListener('click', () => {
                    refreshClicks += 1;
                    emit({ type: 'refresh-click', count: refreshClicks });
                });
                const chart = root.querySelector('#chart');
                chart.getContext('2d').fillRect(0, 0, 240, 120);
            }
        });`;
        const entryBase64 = Buffer.from(source, "utf8").toString("base64");
        await page.evaluate(
            async ({ surfaceHostUrl, entryBase64, snapshot }) => {
                const iframe = window.document.createElement("iframe");
                iframe.setAttribute("sandbox", "allow-scripts");
                iframe.style.width = "320px";
                iframe.style.height = "200px";
                iframe.style.transform = "scale(1.5)";
                iframe.style.transformOrigin = "top left";
                iframe.style.display = "block";
                const visual = window.document.createElement("div");
                visual.style.position = "relative";
                visual.style.width = "480px";
                visual.style.height = "300px";
                const annotationViewport = window.document.createElement("div");
                annotationViewport.className = "sticker-annotation-layer-viewport";
                annotationViewport.style.position = "absolute";
                annotationViewport.style.inset = "0";
                annotationViewport.style.pointerEvents = "none";
                const annotationRoot = window.document.createElement("div");
                annotationRoot.style.position = "absolute";
                annotationRoot.style.inset = "0";
                annotationRoot.style.pointerEvents = "none";
                annotationViewport.append(annotationRoot);
                const channel = new MessageChannel();
                const messages = [];
                const token = "surface-token-pointer-routing";
                channel.port1.onmessage = (event) => messages.push(event.data);
                channel.port1.start();
                window.__surfacePointerSmoke = { channel, iframe, messages, token };
                const loaded = new Promise((resolve) => iframe.addEventListener("load", resolve, { once: true }));
                iframe.src = surfaceHostUrl;
                visual.append(iframe, annotationViewport);
                window.document.body.replaceChildren(visual);
                await Promise.race([
                    loaded,
                    new Promise((_, reject) => window.setTimeout(
                        () => reject(new Error("pointer-routing Surface iframe load timed out")),
                        60_000,
                    )),
                ]);
                iframe.contentWindow.postMessage({
                    type: "surface:init",
                    token,
                    entryBase64,
                    snapshot,
                    resources: {},
                }, "*", [channel.port2]);
            },
            { surfaceHostUrl, entryBase64, snapshot },
        );
        try {
            await page.waitForFunction(() => window.__surfacePointerSmoke?.messages.some(
                (message) => message?.type === "ready",
            ), undefined, { timeout: 180_000 });
        } catch (error) {
            const diagnostics = await page.evaluate(() => ({
                frameUrl: window.__surfacePointerSmoke?.iframe?.src,
                messageTypes: window.__surfacePointerSmoke?.messages?.map((message) => message?.type),
            })).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }));
            throw new Error(`pointer-routing Surface did not become ready: ${String(error)} ${JSON.stringify({ diagnostics, browserEvents })}`);
        }
        const surfaceFrame = page.frames().find((frame) => frame.url() === surfaceHostUrl);
        if (!surfaceFrame) throw new Error("pointer-routing Surface frame is unavailable");
        const controls = await surfaceFrame.evaluate(() => {
            const chart = document.querySelector("#chart");
            const input = document.querySelector("#symbol");
            const refresh = document.querySelector("#refresh");
            const rect = (element) => {
                if (!(element instanceof Element)) return null;
                const bounds = element.getBoundingClientRect();
                return {
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                };
            };
            return { chart: rect(chart), input: rect(input), refresh: rect(refresh), body: document.body.innerHTML };
        });
        const iframeBox = await page.evaluate(() => {
            const iframe = document.querySelector("iframe");
            if (!(iframe instanceof HTMLIFrameElement)) return null;
            const bounds = iframe.getBoundingClientRect();
            return {
                x: bounds.x,
                y: bounds.y,
                scaleX: bounds.width / iframe.clientWidth,
                scaleY: bounds.height / iframe.clientHeight,
            };
        });
        if (!controls.chart || !controls.input || !controls.refresh || !iframeBox) {
            throw new Error(`pointer-routing controls are unavailable: ${controls.body}`);
        }
        const dragStart = {
            x: iframeBox.x + (controls.chart.x + 60) * iframeBox.scaleX,
            y: iframeBox.y + (controls.chart.y + 40) * iframeBox.scaleY,
        };
        const dragEnd = {
            x: dragStart.x + 80,
            y: dragStart.y + 40,
        };
        await page.mouse.move(dragStart.x, dragStart.y);
        await page.mouse.down();
        await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 4 });
        await page.mouse.up();
        await page.mouse.click(
            iframeBox.x + (controls.input.x + Math.min(20, controls.input.width / 2)) * iframeBox.scaleX,
            iframeBox.y + (controls.input.y + controls.input.height / 2) * iframeBox.scaleY,
        );
        await surfaceFrame.evaluate(() => document.querySelector("#symbol")?.blur());
        await page.evaluate(() => {
            const state = window.__surfacePointerSmoke;
            state.channel.port1.postMessage({ type: "restore-editable-focus", token: state.token });
        });
        await page.waitForTimeout(20);
        await page.keyboard.press("Control+A");
        await page.keyboard.type("SH600000");
        await page.keyboard.press("Control+E");
        await page.keyboard.press("Escape");
        await surfaceFrame.evaluate(() => {
            document.querySelector("#symbol").dataset.consumeEscape = "true";
        });
        await page.keyboard.press("Escape");
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, -120);
        await page.keyboard.up("Control");
        await page.keyboard.down("Alt");
        await page.mouse.wheel(0, 120);
        await page.keyboard.up("Alt");
        const inputState = await surfaceFrame.evaluate(() => ({
            activeId: document.activeElement?.id,
            value: document.querySelector("#symbol")?.value,
        }));
        await page.mouse.click(
            iframeBox.x + (controls.refresh.x + Math.min(20, controls.refresh.width / 2)) * iframeBox.scaleX,
            iframeBox.y + (controls.refresh.y + controls.refresh.height / 2) * iframeBox.scaleY,
        );
        await page.evaluate(({ chart, input, refresh }) => {
            const state = window.__surfacePointerSmoke;
            const postPointer = (type, point, gestureId) => state.channel.port1.postMessage({
                type: "pointer",
                token: state.token,
                pointer: {
                    type,
                    gestureId,
                    x: point.x,
                    y: point.y,
                    ctrlKey: false,
                    altKey: false,
                    shiftKey: false,
                    metaKey: false,
                },
            });
            const chartPoint = { x: chart.x + 20, y: chart.y + 20 };
            const inputPoint = { x: input.x + 10, y: input.y + input.height / 2 };
            const refreshPoint = { x: refresh.x + Math.min(20, refresh.width / 2), y: refresh.y + refresh.height / 2 };
            postPointer("mousedown", chartPoint, 101);
            postPointer("mousemove", { x: chartPoint.x + 3, y: chartPoint.y + 2 }, 999);
            postPointer("mousemove", { x: chartPoint.x + 4, y: chartPoint.y + 2 }, 101);
            postPointer("mouseup", chartPoint, 101);
            postPointer("mousedown", inputPoint, 102);
            postPointer("mouseup", inputPoint, 102);
            // A native shield can move the release sample a few pixels. This
            // must still activate the control, while the canvas path remains a
            // drag-only path.
            postPointer("mousedown", refreshPoint, 103);
            postPointer("mouseup", { x: refreshPoint.x + 6, y: refreshPoint.y + 1 }, 103);
            // A mismatched release must terminate the old background gesture
            // rather than poisoning every later control click/drag in this iframe.
            postPointer("mousedown", chartPoint, 201);
            postPointer("mouseup", chartPoint, 202);
            postPointer("mousedown", chartPoint, 203);
            postPointer("mouseup", chartPoint, 203);
            postPointer("mousedown", chartPoint, 301);
            postPointer("mousemove", { x: -20, y: -10 }, 301);
            postPointer("mouseup", { x: -20, y: -10 }, 301);
        }, controls);
        await page.waitForTimeout(50);
        const result = await page.evaluate(() => {
            const state = window.__surfacePointerSmoke;
            const messageTypes = state.messages.map((message) => message?.type);
            const dragStarts = state.messages.filter((message) => message?.type === "host-drag-start");
            const dragMoves = state.messages.filter((message) => message?.type === "host-drag-move");
            const dragEnds = state.messages.filter((message) => message?.type === "host-drag-end");
            const hostWheels = state.messages.filter((message) => message?.type === "host-wheel");
            const hostKeydowns = state.messages.filter((message) => message?.type === "host-keydown");
            const refreshClicks = state.messages.filter(
                (message) => message?.type === "event" && message?.event?.type === "refresh-click",
            ).length;
            state.channel.port1.postMessage({ type: "dispose", token: state.token });
            state.channel.port1.close();
            state.iframe.remove();
            delete window.__surfacePointerSmoke;
            return {
                messageTypes,
                activationCount: messageTypes.filter((type) => type === "host-activate").length,
                dragStartCount: dragStarts.length,
                dragMoveCount: dragMoves.length,
                dragEndCount: dragEnds.length,
                dragPointer: dragStarts[0]?.pointer,
                dragPointers: dragStarts.map((message) => message.pointer),
                dragGestureIds: dragStarts.map((message) => message.pointer?.gestureId),
                dragMoveGestureIds: dragMoves.map((message) => message.pointer?.gestureId),
                dragEndGestureIds: dragEnds.map((message) => message.pointer?.gestureId),
                dragEndPointer: dragEnds[0]?.pointer,
                hostWheels: hostWheels.map((message) => message.wheel),
                hostKeydowns: hostKeydowns.map((message) => message.keydown),
                refreshClicks,
            };
        });
        result.inputState = inputState;
        if (result.activationCount < 4) {
            throw new Error(`pointer-routing did not activate the host for trusted and native-shield targets: ${JSON.stringify(result)}`);
        }
        if (result.dragStartCount !== 5) {
            throw new Error(`pointer-routing must start each background gesture once and never drag controls: ${JSON.stringify(result)}`);
        }
        if (
            result.dragGestureIds.some((gestureId) => !Number.isSafeInteger(gestureId) || gestureId <= 0)
            || [101, 201, 203, 301].some(
                (gestureId) => result.dragGestureIds.filter((value) => value === gestureId).length !== 1,
            )
            || result.dragGestureIds.includes(102)
            || result.dragGestureIds.includes(103)
        ) {
            throw new Error(`pointer-routing did not preserve gesture ownership: ${JSON.stringify(result)}`);
        }
        if (
            result.dragMoveGestureIds.filter((gestureId) => gestureId === 101).length !== 1
            || result.dragMoveGestureIds.filter((gestureId) => gestureId === 301).length !== 1
            || result.dragEndCount !== 5
            || [101, 201, 203, 301].some(
                (gestureId) => result.dragEndGestureIds.filter((value) => value === gestureId).length !== 1,
            )
        ) {
            throw new Error(`pointer-routing did not relay a complete drag stream: ${JSON.stringify(result)}`);
        }
        if (!Number.isFinite(result.dragPointer?.x) || !Number.isFinite(result.dragPointer?.y)) {
            throw new Error(`pointer-routing returned invalid drag coordinates: ${JSON.stringify(result)}`);
        }
        if (result.dragEndPointer?.pointerId !== result.dragPointer?.pointerId) {
            throw new Error(`pointer-routing changed pointer identity mid-drag: ${JSON.stringify(result)}`);
        }
        const expectedTrustedDragPoint = {
            x: controls.chart.x + 60,
            y: controls.chart.y + 40,
        };
        if (
            Math.abs(result.dragPointer.x - expectedTrustedDragPoint.x) > 2
            || Math.abs(result.dragPointer.y - expectedTrustedDragPoint.y) > 2
            || Math.abs(result.dragPointer.normalizedX - expectedTrustedDragPoint.x / 320) > 0.015
            || Math.abs(result.dragPointer.normalizedY - expectedTrustedDragPoint.y / 200) > 0.015
        ) {
            throw new Error(`pointer-routing changed transformed Surface coordinates: ${JSON.stringify(result)}`);
        }
        if (result.inputState?.activeId !== "symbol" || result.inputState?.value !== "SH600000") {
            throw new Error(`pointer-routing could not focus and edit the Surface input: ${JSON.stringify(result)}`);
        }
        if (result.refreshClicks !== 2) {
            throw new Error(`pointer-routing could not click the Surface button after native jitter: ${JSON.stringify(result)}`);
        }
        if (!result.hostWheels?.some((wheel) => wheel?.ctrlKey === true && wheel?.deltaY < 0)) {
            throw new Error(`pointer-routing did not bridge the modifier wheel gesture: ${JSON.stringify(result)}`);
        }
        if (!result.hostWheels?.some((wheel) => wheel?.altKey === true && wheel?.deltaY > 0)) {
            throw new Error(`pointer-routing did not bridge the opacity wheel gesture: ${JSON.stringify(result)}`);
        }
        if (!result.hostKeydowns?.some((keydown) => keydown?.code === "KeyE" && keydown?.ctrlKey === true)) {
            throw new Error(`pointer-routing did not bridge Ctrl+E from the focused Surface input: ${JSON.stringify(result)}`);
        }
        if (result.hostKeydowns?.filter((keydown) => keydown?.key === "Escape").length !== 1) {
            throw new Error(`pointer-routing must bridge only an unconsumed Escape from the focused Surface input: ${JSON.stringify(result)}`);
        }
        return {
            name: "pointer-routing",
            expectedFailure: null,
            outcome: { kind: "interaction", ...result },
            browserEvents: [...browserEvents],
        };
    };

    const scenarios = [];
    const scenarioFilter = process.env.HOOK_JAVASCRIPT_SURFACE_SCENARIO;
    const runSelectedScenario = async (name, source, expectedFailure) => {
        if (scenarioFilter && scenarioFilter !== name) return;
        scenarios.push(await runScenario(name, source, expectedFailure));
    };
    await runSelectedScenario(
        "healthy",
        "NeuroSurface.define({ mount({ root }) { root.textContent = 'ready'; } });",
        null,
    );
    if (!scenarioFilter || scenarioFilter === "stray-message") {
        scenarios.push(await runStrayMessageScenario());
    }
    if (!scenarioFilter || scenarioFilter === "pointer-routing") {
        scenarios.push(await runPointerRoutingScenario());
    }
    await runSelectedScenario(
        "timer-budget",
        "NeuroSurface.define({ mount() { for (let i = 0; i < 65; i += 1) setInterval(() => {}, 60000); } });",
        "timer budget exceeded",
    );
    await runSelectedScenario(
        "dom-budget",
        "NeuroSurface.define({ mount({ root }) { for (let i = 0; i < 1001; i += 1) root.append(document.createElement('span')); } });",
        "DOM node budget exceeded",
    );
    await runSelectedScenario(
        "cpu-budget",
        "NeuroSurface.define({ mount() { let runs = 0; const burn = () => { const until = performance.now() + 800; while (performance.now() < until) {} runs += 1; if (runs < 2) setTimeout(burn, 20); }; setTimeout(burn, 20); } });",
        "CPU budget exceeded",
    );
    await runSelectedScenario(
        "memory-budget",
        "NeuroSurface.define({ mount() { globalThis.__surfaceMemoryHold = []; let chunk = 0; const allocate = () => { globalThis.__surfaceMemoryHold.push(new Array(500000).fill(chunk)); chunk += 1; if (chunk < 44) setTimeout(allocate, 20); }; allocate(); } });",
        "memory budget exceeded",
    );

    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        browser: await browser.version(),
        sourceModule: "public/javascript-surface-host.html",
        scenarios,
        passed: true,
    };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
    await browser?.close();
    if (server.listening) {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections?.();
        });
    }
}
