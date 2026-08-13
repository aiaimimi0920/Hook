import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const hookRoot = process.env.HOOK_ACCEPTANCE_HOOK_ROOT;
const cdpUrl = process.env.HOOK_ACCEPTANCE_CDP_URL;
const resultPath = process.env.HOOK_ACCEPTANCE_RESULT_PATH;
const marker = process.env.HOOK_ACCEPTANCE_MARKER;
const mode = process.env.HOOK_ACCEPTANCE_MODE || "probe";
const persistSettings = process.env.HOOK_ACCEPTANCE_PERSIST_SETTINGS === "1";
const timeoutMs = Number(process.env.HOOK_ACCEPTANCE_TIMEOUT_MS || "60000");

if (!hookRoot || !cdpUrl || !resultPath || !marker) {
    throw new Error("native acceptance probe environment is incomplete");
}

const require = createRequire(path.join(hookRoot, "package.json"));
const { chromium } = require("playwright");
const writeResult = async (value) => {
    await writeFile(resultPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let browser;
try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const deadline = Date.now() + timeoutMs;
    let page = null;
    while (Date.now() < deadline && !page) {
        for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
            if (candidate.isClosed()) continue;
            const native = await candidate
                .evaluate(() => Boolean(window.__TAURI_INTERNALS__))
                .catch(() => false);
            if (native) {
                page = candidate;
                break;
            }
        }
        if (!page) await delay(200);
    }
    if (!page) throw new Error("no Hook page exposed the native Tauri runtime");

    if (mode === "exit") {
        const requested = await page.evaluate((exitMarker) => {
            const invoke = window.__TAURI_INTERNALS__?.invoke;
            if (typeof invoke !== "function") return false;
            void invoke("request_native_acceptance_exit", { marker: exitMarker }).catch(() => {});
            return true;
        }, marker);
        await writeResult({ status: requested ? "exit_requested" : "failed", marker, requested });
        if (!requested) throw new Error("native acceptance exit command was not dispatched");
    } else if (mode === "surface") {
        const surfaceRoot = page.locator("[data-surface-instance-id]").filter({
            has: page.locator('[data-surface-node-id="refresh"]'),
        }).first();
        await surfaceRoot.waitFor({ state: "visible", timeout: timeoutMs });
        const refreshButton = surfaceRoot.locator('[data-surface-node-id="refresh"]');
        await refreshButton.waitFor({ state: "visible", timeout: timeoutMs });

        const beforeRevision = Number(await surfaceRoot.getAttribute("data-surface-revision"));
        const instanceId = await surfaceRoot.getAttribute("data-surface-instance-id");
        const attachmentId = await surfaceRoot.getAttribute("data-surface-attachment-id");
        const unitId = await surfaceRoot.getAttribute("data-surface-unit-id");
        if (!instanceId || !attachmentId || !unitId || !Number.isFinite(beforeRevision)) {
            throw new Error("mounted dashboard Surface is missing identity or revision attributes");
        }

        await refreshButton.click();
        await page.waitForFunction(
            ({ instanceId, beforeRevision }) => {
                const root = document.querySelector(`[data-surface-instance-id="${CSS.escape(instanceId)}"]`);
                const revision = Number(root?.getAttribute("data-surface-revision"));
                return Number.isFinite(revision) && revision > beforeRevision;
            },
            { instanceId, beforeRevision },
            { timeout: timeoutMs },
        );
        const chart = surfaceRoot.locator('img[data-surface-node-id="chart"]');
        await chart.waitFor({ state: "visible", timeout: timeoutMs });
        await page.waitForFunction(
            ({ instanceId }) => {
                const root = document.querySelector(`[data-surface-instance-id="${CSS.escape(instanceId)}"]`);
                const image = root?.querySelector('img[data-surface-node-id="chart"]');
                return image?.getAttribute("src")?.startsWith("data:image/png;base64,") === true;
            },
            { instanceId },
            { timeout: timeoutMs },
        );
        const afterRevision = Number(await surfaceRoot.getAttribute("data-surface-revision"));
        const chartSource = await chart.getAttribute("src");
        await page.locator("#app-main").click({ position: { x: 4, y: 4 } });
        const selectionCleared = await page.evaluate(() =>
            !document.querySelector('[data-unit-id].ring-2, [data-unit-id][data-selected="true"]'),
        );
        if (!selectionCleared) {
            throw new Error("native acceptance probe could not clear Surface selection after verification");
        }
        await writeResult({
            status: "passed",
            marker,
            nativeTauriRuntime: true,
            surface: {
                instanceId,
                attachmentId,
                unitId,
                beforeRevision,
                afterRevision,
                refreshButtonVisible: await refreshButton.isVisible(),
                chartDataUrl: chartSource?.startsWith("data:image/png;base64,") === true,
                chartDataUrlLength: chartSource?.length || 0,
                selectionCleared,
            },
        });
    } else {
        const result = await page.evaluate(
            async ({ probeMarker, shouldPersistSettings }) => {
                const invoke = window.__TAURI_INTERNALS__?.invoke;
                if (typeof invoke !== "function") {
                    throw new Error("native Tauri invoke is unavailable");
                }
                await invoke("show_canvas_window");
                const bootProfile = await invoke("get_boot_profile");
                const appSettings = await invoke("load_app_settings");
                const savedSettings = shouldPersistSettings
                    ? await invoke("save_app_settings", { settings: appSettings })
                    : null;
                await invoke("append_runtime_log", {
                    event: "native-acceptance-probe",
                    detail: probeMarker,
                });
                return {
                    bootProfile,
                    appSettings,
                    savedSettings,
                    title: document.title,
                    url: location.href,
                    bodyTextLength: (document.body?.innerText || "").length,
                    viewport: { width: innerWidth, height: innerHeight },
                };
            },
            { probeMarker: marker, shouldPersistSettings: persistSettings },
        );
        await writeResult({
            status: "passed",
            marker,
            nativeTauriRuntime: true,
            ...result,
        });
    }
} catch (error) {
    await writeResult({
        status: "failed",
        marker,
        error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
} finally {
    if (browser) await browser.close().catch(() => {});
}
