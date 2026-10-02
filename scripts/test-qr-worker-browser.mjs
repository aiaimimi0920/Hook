import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { build } from "vite";
import { chromium } from "playwright";

// Exercise the actual production-built module worker, not a mocked JS decoder.
const fixture = JSON.parse(await fs.readFile(new URL("./fixtures/qr-worker.json", import.meta.url), "utf8"));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "hook-qr-worker-browser-"));
let browser;
let server;
try {
    await build({ build: { outDir: temporary, emptyOutDir: true }, logLevel: "warn" });
    const assets = path.join(temporary, "_build/assets");
    const workers = (await fs.readdir(assets)).filter((name) => /^projectionQrDecode\.worker-.*\.js$/.test(name));
    assert.equal(workers.length, 1, "Expected one production QR worker bundle");
    const workerSource = await fs.readFile(path.join(assets, workers[0]));
    server = http.createServer((request, response) => {
        if (request.url === "/worker.js") {
            response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(workerSource);
        } else if (request.url === "/") {
            response.writeHead(200, { "Content-Type": "text/html" }); response.end("<!doctype html><title>QR worker test</title>");
        } else { response.writeHead(404); response.end(); }
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const result = await page.evaluate(async ({ rows, text }) => {
        const worker = new Worker("/worker.js", { type: "module" });
        const ask = (data, transfer = []) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("QR worker timeout")), 10000);
            worker.onerror = (event) => { clearTimeout(timer); reject(new Error(event.message)); };
            worker.onmessage = (event) => { clearTimeout(timer); resolve({ data: event.data, origin: event.origin }); };
            try { worker.postMessage(data, transfer); }
            catch (error) { clearTimeout(timer); reject(error); }
        });
        try {
            const invalid = await ask(null);
            const wrongType = await ask({ pixels: new Uint8Array(4), width: 1, height: 1 });
            const size = rows.length * 4;
            const pixels = new Uint8ClampedArray(size * size * 4);
            for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                const offset = (y * size + x) * 4;
                const shade = rows[Math.floor(y / 4)][Math.floor(x / 4)] === "1" ? 0 : 255;
                pixels.set([shade, shade, shade, 255], offset);
            }
            const decoded = await ask({ pixels, width: size, height: size }, [pixels.buffer]);
            const repeated = await ask({ pixels: null, width: 1, height: 1 });
            return { invalid, wrongType, decoded, repeated, detached: pixels.byteLength === 0, expected: text };
        } finally { worker.terminate(); }
    }, fixture);
    for (const key of ["invalid", "wrongType", "repeated"]) {
        assert.equal(result[key].data.error, "projection_invalid_image");
        assert.equal(result[key].origin, "");
    }
    assert.equal(result.decoded.data.text, result.expected);
    assert.equal(result.decoded.origin, "");
    assert.equal(result.detached, true);
    // Loading the same bundle in a Window must not register a message handler.
    await page.addScriptTag({ type: "module", url: "/worker.js" });
    assert.equal(await page.evaluate(() => window.onmessage), null);
    const evidence = { productionWorker: workers[0], browser: browser.version(),
        malformedRejected: true, validQrDecoded: true, transferredPixels: true,
        emptyChannelOriginAccepted: true, windowHandlerAbsent: true };
    await fs.mkdir("artifacts/qr-worker-browser", { recursive: true });
    await fs.writeFile("artifacts/qr-worker-browser/result.json", `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence));
} finally {
    await browser?.close();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await fs.rm(temporary, { recursive: true, force: true });
}
