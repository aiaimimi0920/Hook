import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.resolve(
    root,
    process.env.HOOK_JAVASCRIPT_SURFACE_SMOKE_OUTPUT
        || "artifacts/runtime-performance/javascript-surface-browser.json",
);

const vite = await createServer({
    configFile: path.join(root, "vite.config.ts"),
    root,
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    appType: "custom",
    logLevel: "error",
});

let browser;
try {
    await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Vite test server did not bind TCP");
    const surfaceModuleUrl = `http://127.0.0.1:${address.port}/src/components/JavaScriptSurface.tsx`;

    browser = await chromium.launch({
        headless: true,
        args: ["--enable-precise-memory-info"],
    });
    const page = await browser.newPage();
    const moduleResponse = await page.goto(surfaceModuleUrl, { waitUntil: "domcontentloaded" });
    if (!moduleResponse?.ok()) {
        throw new Error(`JavaScript Surface module server returned ${moduleResponse?.status()}`);
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
        const entryBase64 = Buffer.from(source, "utf8").toString("base64");
        const document = await page.evaluate(
            async ({ surfaceModuleUrl, entryBase64, nonce }) => {
                const surfaceModule = await import(surfaceModuleUrl);
                if (typeof surfaceModule.buildJavaScriptSurfaceDocument !== "function") {
                    throw new Error("JavaScript Surface document builder is unavailable");
                }
                return surfaceModule.buildJavaScriptSurfaceDocument(entryBase64, nonce);
            },
            { surfaceModuleUrl, entryBase64, nonce: `nonce-${name}` },
        );
        const result = await page.evaluate(
            async ({ document, snapshot, expectedFailure }) => {
                const iframe = window.document.createElement("iframe");
                iframe.setAttribute("sandbox", "allow-scripts");
                iframe.srcdoc = document;
                window.document.body.replaceChildren(iframe);

                const messages = [];
                const token = "surface-token-browser-smoke";
                const outcome = await new Promise((resolve, reject) => {
                    const timeout = window.setTimeout(() => {
                        resolve({ kind: "timeout" });
                    }, 8_000);
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
                            snapshot,
                            resources: {},
                        }, "*", [channel.port2]);
                    }, { once: true });
                });
                iframe.remove();
                return { outcome, messageTypes: messages.map((message) => message?.type) };
            },
            { document, snapshot, expectedFailure },
        );

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
        "NeuroSurface.define({ mount() { const until = performance.now() + 400; while (performance.now() < until) {} } });",
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
        sourceModule: "src/components/JavaScriptSurface.tsx",
        scenarios,
        passed: true,
    };
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
    await browser?.close();
    await vite.close();
}
