import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { createBrowserEventRecorder } from "./javascript-surface-browser-smoke/browser-events.mjs";
import {
    createScenarioRunner,
    surfaceSnapshot,
} from "./javascript-surface-browser-smoke/basic-scenarios.mjs";
import { runPointerRoutingScenario } from "./javascript-surface-browser-smoke/pointer-routing.mjs";
import {
    closeSurfaceServer,
    createSurfaceServer,
    listenSurfaceServer,
    verifySurfaceAssets,
} from "./javascript-surface-browser-smoke/server.mjs";

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
const scenarioFilter = process.env.HOOK_JAVASCRIPT_SURFACE_SCENARIO;
const knownScenarios = new Set([
    "healthy",
    "stray-message",
    "pointer-routing",
    "timer-budget",
    "dom-budget",
    "cpu-budget",
    "memory-budget",
]);
if (scenarioFilter && !knownScenarios.has(scenarioFilter)) {
    throw new Error(`Unknown JavaScript Surface smoke scenario: ${scenarioFilter}`);
}

const server = createSurfaceServer({ root, tauriCsp });
let browser;
let eventRecorder;
try {
    const urls = await listenSurfaceServer(server);
    await verifySurfaceAssets(urls);
    browser = await chromium.launch({
        headless: true,
        args: ["--enable-precise-memory-info"],
    });
    const page = await browser.newPage({ deviceScaleFactor: 1.5 });
    eventRecorder = createBrowserEventRecorder(page);
    const harnessResponse = await page.goto(urls.harnessUrl, { waitUntil: "domcontentloaded" });
    if (!harnessResponse?.ok()) {
        throw new Error(`JavaScript Surface harness returned ${harnessResponse?.status()}`);
    }

    const { runScenario, runStrayMessageScenario } = createScenarioRunner({
        page,
        surfaceHostUrl: urls.surfaceHostUrl,
        snapshot: surfaceSnapshot,
        eventRecorder,
    });
    const scenarios = [];
    const selected = (name) => !scenarioFilter || scenarioFilter === name;
    if (selected("healthy")) {
        scenarios.push(await runScenario(
            "healthy",
            "NeuroSurface.define({ mount({ root }) { root.textContent = 'ready'; } });",
            null,
        ));
    }
    if (selected("stray-message")) {
        scenarios.push(await runStrayMessageScenario());
    }
    if (selected("pointer-routing")) {
        scenarios.push(await runPointerRoutingScenario({
            page,
            surfaceHostUrl: urls.surfaceHostUrl,
            snapshot: surfaceSnapshot,
            eventRecorder,
        }));
    }
    const budgetScenarios = [
        ["timer-budget", "NeuroSurface.define({ mount() { for (let i = 0; i < 65; i += 1) setInterval(() => {}, 60000); } });", "timer budget exceeded"],
        ["dom-budget", "NeuroSurface.define({ mount({ root }) { for (let i = 0; i < 1001; i += 1) root.append(document.createElement('span')); } });", "DOM node budget exceeded"],
        ["cpu-budget", "NeuroSurface.define({ mount() { let runs = 0; const burn = () => { const until = performance.now() + 800; while (performance.now() < until) {} runs += 1; if (runs < 2) setTimeout(burn, 20); }; setTimeout(burn, 20); } });", "CPU budget exceeded"],
        ["memory-budget", "NeuroSurface.define({ mount() { globalThis.__surfaceMemoryHold = []; let chunk = 0; const allocate = () => { globalThis.__surfaceMemoryHold.push(new Array(500000).fill(chunk)); chunk += 1; if (chunk < 44) setTimeout(allocate, 20); }; allocate(); } });", "memory budget exceeded"],
    ];
    for (const [name, source, expectedFailure] of budgetScenarios) {
        if (selected(name)) scenarios.push(await runScenario(name, source, expectedFailure));
    }
    if (scenarios.length !== (scenarioFilter ? 1 : knownScenarios.size)) {
        throw new Error(`JavaScript Surface smoke selected an unexpected scenario count: ${scenarios.length}`);
    }

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
    eventRecorder?.dispose();
    await browser?.close();
    await closeSurfaceServer(server);
}
