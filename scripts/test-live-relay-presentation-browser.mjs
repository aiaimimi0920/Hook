import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { chromium } from "playwright";

// 使用真实浏览器解码生产 BMP/JPEG 和候选帧 owner，不模拟 Image.decode。
const output = path.resolve(process.argv[2] || "artifacts/live-relay-presentation-browser");
await fs.mkdir(output, { recursive: true });
const modules = new Map();
const jpegFixture = await fs.readFile(new URL("../protocol/fixtures/live-jpeg-v1.nllv", import.meta.url));
for (const name of ["liveRelay", "liveRelayPresentation"]) {
    const source = await fs.readFile(new URL(`../src/services/${name}.ts`, import.meta.url), "utf8");
    modules.set(`/${name}.js`, stripTypeScriptTypes(source));
}
const server = http.createServer((request, response) => {
    const source = modules.get(request.url);
    if (source) {
        response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(source);
    } else if (request.url === "/fixture.jpg") {
        response.writeHead(200, { "Content-Type": "image/jpeg" }); response.end(jpegFixture.subarray(64));
    } else if (request.url === "/") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<!doctype html><title>LiveRelay decoded pixels</title><canvas width='2' height='1'></canvas>");
    } else { response.writeHead(404); response.end(); }
});
let browser;
try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const result = await page.evaluate(async () => {
        const { encodeBgraAsBmp } = await import("/liveRelay.js");
        const { decodeRelayImage } = await import("/liveRelayPresentation.js");
        const liveUrls = new Set();
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = (blob) => { const url = create(blob); liveUrls.add(url); return url; };
        URL.revokeObjectURL = (url) => { liveUrls.delete(url); revoke(url); };
        const canvas = document.querySelector("canvas"), ctx = canvas.getContext("2d");
        const pixels = [], timings = [];
        const size = { width: 2, height: 1, codec: "raw_bgra" };
        for (const bgra of [[0, 0, 255, 255, 0, 255, 0, 255], [255, 0, 0, 255, 255, 255, 255, 255]]) {
            const started = performance.now();
            const url = await decodeRelayImage(encodeBgraAsBmp(new Uint8Array(bgra), 2, 1), size, new AbortController().signal);
            const image = new Image(); image.src = url; await image.decode();
            ctx.drawImage(image, 0, 0);
            pixels.push([...ctx.getImageData(0, 0, 2, 1).data]);
            timings.push(performance.now() - started);
            URL.revokeObjectURL(url);
        }
        const failures = [];
        for (const [bitmap, expected] of [
            [new Uint8Array([1, 2, 3]), size],
            [encodeBgraAsBmp(new Uint8Array(8), 2, 1), { width: 3, height: 1 }],
        ]) {
            try { await decodeRelayImage(bitmap, expected, new AbortController().signal); }
            catch (error) { failures.push(error.message); }
        }
        const abort = new AbortController();
        const pending = decodeRelayImage(encodeBgraAsBmp(new Uint8Array(8), 2, 1), size, abort.signal);
        abort.abort();
        try { await pending; } catch (error) { failures.push(error.message); }
        const jpeg = new Uint8Array(await (await fetch("/fixture.jpg")).arrayBuffer());
        const jpegSize = { width: 64, height: 32, codec: "jpeg" };
        const jpegStarted = performance.now();
        const jpegUrl = await decodeRelayImage(jpeg, jpegSize, new AbortController().signal);
        const jpegImage = new Image(); jpegImage.src = jpegUrl; await jpegImage.decode();
        canvas.width = 64; canvas.height = 32; ctx.drawImage(jpegImage, 0, 0);
        const jpegPixels = [8, 48].map((x) => [...ctx.getImageData(x, 16, 1, 1).data]);
        URL.revokeObjectURL(jpegUrl);
        const jpegDecodeMs = performance.now() - jpegStarted;
        const jpegFailures = [];
        for (const [bytes, expected] of [[new Uint8Array([255, 216, 0, 255, 217]), jpegSize], [jpeg, { ...jpegSize, width: 63 }]]) {
            try { await decodeRelayImage(bytes, expected, new AbortController().signal); }
            catch (error) { jpegFailures.push(error.message); }
        }
        const jpegAbort = new AbortController();
        const jpegPending = decodeRelayImage(jpeg, jpegSize, jpegAbort.signal); jpegAbort.abort();
        try { await jpegPending; } catch (error) { jpegFailures.push(error.message); }
        return { pixels, timings, failures, jpegPixels, jpegDecodeMs, jpegFailures, jpegBytes: jpeg.length, rawBytes: 64 * 32 * 4, remainingUrls: liveUrls.size };
    });
    assert.deepEqual(result.pixels, [[255, 0, 0, 255, 0, 255, 0, 255], [0, 0, 255, 255, 255, 255, 255, 255]]);
    assert.deepEqual(result.failures, ["live_relay_decode_failed", "live_relay_decode_dimensions_mismatch", "live_relay_decode_cancelled"]);
    assert.equal(result.remainingUrls, 0);
    for (let i = 0; i < 2; i++) {
        const expected = i === 0 ? [230, 15, 20, 255] : [20, 230, 15, 255];
        result.jpegPixels[i].forEach((actual, channel) => assert.ok(Math.abs(actual - expected[channel]) < 8));
    }
    assert.deepEqual(result.jpegFailures, result.failures);
    const evidence = { scope: "chromium-bmp-jpeg-decode-and-canvas-readback", browser: browser.version(), ...result,
        nativeCaptureTested: false, crossDeviceTested: false, physicalPresentationTested: false };
    await fs.writeFile(path.join(output, "result.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(evidence));
} finally {
    await browser?.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
}
