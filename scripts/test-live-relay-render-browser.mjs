import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createHttpServer } from "node:http";
import { chromium } from "playwright";
import { createServer } from "vite";
import solid from "vite-plugin-solid";

// Mount the production viewer. Only IPC submission and native rect sync are fixtures.
if (!process.argv[2]) throw new Error("Usage: node scripts/test-live-relay-render-browser.mjs <output-directory>");
const output = path.resolve(process.argv[2]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harnessId = path.join(root, "relay-render-harness.tsx").replaceAll("\\", "/");
const harness = `
import { render } from "solid-js/web";
import { LiveRelayLayer } from "./src/components/LiveRelayLayer";
import { liveRelayActions, liveRelayViews } from "./src/store/liveRelayStore";
import { relayStatus } from "./__tests__/fixtures/liveRelay";
const urls = new Set();
const originalRevoke = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = url => { urls.delete(url); originalRevoke(url); };
const mount = () => liveRelayActions.add({ ...relayStatus }, "render fixture", { x: 0, y: 0, width: 320, height: 240 });
mount();
const controller = { sendInput: async () => {}, stop: async id => liveRelayActions.remove(id) };
const unmount = render(() => <LiveRelayLayer controller={controller} />, document.body);
window.relayRenderTest = {
  async publish(color, frameId, epoch = 1, broken = false) {
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 32;
    const context = canvas.getContext("2d"); context.fillStyle = color; context.fillRect(0, 0, 64, 32);
    const blob = broken ? new Blob(["broken"], {type:"image/jpeg"})
      : await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    const url = URL.createObjectURL(blob); urls.add(url);
    liveRelayActions.updateStatus("relay:a", { ...relayStatus, epoch });
    const frame = { relayId:"relay:a", liveSessionId:"live:a", epoch, frameId, codec:"jpeg",
      width:64, height:32, byteLength:blob.size, colorSpace:"srgb", droppedFrames:0,
      captureTimestampMs:1, encodeTimestampMs:2, receivedTimestampMs:3 };
    liveRelayActions.updateFrame("relay:a", url, frame, { ...frame, generation:epoch,
      evidence:"decoded_submitted", payloadBytes:blob.size, imageBytes:blob.size,
      readMs:0, prepareMs:0, decodeMs:0, submittedAtMs:performance.now() });
    return url;
  },
  hide(hidden) { document.querySelector("section").style.display = hidden ? "none" : ""; },
  close() { liveRelayActions.updateStatus("relay:a", { ...relayStatus, connectionState:"closed" }); liveRelayActions.clearFrame("relay:a"); },
  stop() { return controller.stop("relay:a"); },
  snapshot() { const element = document.querySelector("[data-live-relay-diagnostic]");
    return element ? JSON.parse(element.getAttribute("data-live-relay-diagnostic")) : null; },
  remount: mount,
  dispose() { unmount(); liveRelayActions.clear(); for (const url of urls) URL.revokeObjectURL(url); return urls.size; },
};
`;

await fs.mkdir(output, { recursive: true });
const server = await createServer({
    root, configFile: false, plugins: [{
        name: "relay-render-fixture",
        resolveId(id) {
            if (id === "/relay-render-harness.tsx") return harnessId;
            if (id === "../services/syncService") return "\0relay-rect-sync";
        },
        load(id) {
            if (id === harnessId) return harness;
            if (id === "\0relay-rect-sync") return "export const syncService = {updateBackendRects: async () => {}};";
        },
        configureServer(instance) {
            instance.middlewares.use((request, response, next) => {
                if (request.url !== "/") return next();
                response.setHeader("Content-Type", "text/html");
                response.end('<!doctype html><title>Hook viewer render evidence</title><script type="module" src="/relay-render-harness.tsx"></script>');
            });
        },
    }, solid({ hot: false })],
    cacheDir: path.join(output, "vite-cache"), logLevel: "error",
    css: { postcss: { plugins: [] } },
    optimizeDeps: { entries: [], noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, fs: { allow: [root, output] } },
});
const httpServer = createHttpServer(server.middlewares);
let browser;
try {
    await new Promise((resolve, reject) => { httpServer.once("error", reject); httpServer.listen(0, "127.0.0.1", resolve); });
    const address = httpServer.address(); assert.ok(address && typeof address !== "string");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const pending = new Set();
    page.on("request", request => pending.add(new URL(request.url()).pathname));
    page.on("requestfinished", request => pending.delete(new URL(request.url()).pathname));
    page.on("requestfailed", request => pending.delete(new URL(request.url()).pathname));
    try { await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "domcontentloaded", timeout: 60000 }); }
    catch (error) { console.error(JSON.stringify({ pending: [...pending].slice(0, 20), errors })); throw error; }
    await page.waitForFunction(() => !!window.relayRenderTest);
    const publish = (color, id, epoch = 1, broken = false) => page.evaluate(
        args => window.relayRenderTest.publish(...args), [color, id, epoch, broken]);
    const snapshot = () => page.evaluate(() => window.relayRenderTest.snapshot());
    const waitFrame = id => page.waitForFunction(id => window.relayRenderTest.snapshot()?.rendering?.frameId === id, id);
    await publish("red", 1); await waitFrame(1);
    const first = await snapshot(); assert.equal(first.renderEvidenceSupported, true);
    assert.equal(first.rendering.evidence, "browser_element_render");
    assert.equal(first.presentation.evidence, "decoded_submitted");
    await publish("blue", 2); await waitFrame(2);
    const second = await snapshot(); assert.ok(second.rendering.renderTimeMs >= first.rendering.renderTimeMs);
    await page.screenshot({ path: path.join(output, "mounted-viewer.png") });
    await page.evaluate(() => window.relayRenderTest.hide(true));
    await publish("green", 3); await page.waitForTimeout(250);
    assert.equal((await snapshot()).rendering, null);
    await page.evaluate(() => window.relayRenderTest.hide(false)); await waitFrame(3);
    await publish("red", 4, 1, true); await page.waitForTimeout(250);
    assert.equal((await snapshot()).rendering, null);
    await publish("green", 1, 2); await waitFrame(1);
    const replacement = await snapshot(); assert.equal(replacement.epoch, 2);
    assert.equal(replacement.rendering.generation, 2);
    await page.evaluate(() => window.relayRenderTest.close());
    assert.equal((await snapshot()).rendering, null);
    await page.evaluate(() => window.relayRenderTest.stop()); assert.equal(await snapshot(), null);
    await page.evaluate(() => window.relayRenderTest.remount());
    await publish("blue", 9); await page.evaluate(() => window.relayRenderTest.stop());
    await page.waitForTimeout(250); assert.equal(await snapshot(), null);
    const remainingUrls = await page.evaluate(() => window.relayRenderTest.dispose());
    assert.equal(remainingUrls, 0); assert.deepEqual(errors, []);
    const result = { schemaVersion: 1, passed: true, scope: "mounted-hook-viewer-browser-element-render",
        browser: browser.version(), first, second, replacement, remainingUrls,
        hiddenNoProof: true, brokenNoProof: true, lateUnmountNoProof: true,
        nativeCaptureTested: false, crossDeviceTested: false, physicalPresentationTested: false };
    await fs.writeFile(path.join(output, "result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(result));
} finally {
    await browser?.close();
    if (httpServer.listening) await new Promise(resolve => httpServer.close(resolve));
    await server.close();
}
