// Isolated feasibility probe, NOT an installed browser adapter or a video-FPS claim.
import { chromium, type Browser, type CDPSession, type Page } from "playwright";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { createDocumentBinding } from "../browser-candidate/documentBinding.ts";

const repo = resolve(import.meta.dirname, "../..");
const output = resolve(process.argv[2] ?? `${repo}/artifacts/live-browser-binding-${Date.now()}`);
assert(output.startsWith(resolve(repo, "artifacts") + sep));
await mkdir(output, { recursive: false });
const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(`<!doctype html><title>Hook owned binding fixture ${request.url === "/b" ? "B" : "A"}</title>
<style>body{margin:0;height:3000px;background:#172322;font:20px monospace}
#target{position:absolute;left:40px;top:120px;width:320px;height:160px;background:${request.url === "/b" ? "#597cf4" : "#31c885"};color:#111}
button{margin:16px;font:20px monospace}#clock{display:block;padding:16px}</style>
<section id="target"><button id="increment">Clicks: 0</button><span id="clock">Starting</span></section>`);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address(); assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const checks: Record<string, unknown> = {};
let browser: Browser | undefined;
let ownedBrowser: ChildProcess | undefined;
let passed = false;
let failure: string | undefined;

function bindSession(source: CDPSession) {
    return createDocumentBinding({
        request: (method, params) => source.send(method, params),
        subscribe(event, listener) {
            if (event === "close") {
                source.on("close", listener); return () => { source.off("close", listener); };
            }
            source.on(event, listener); return () => { source.off(event, listener); };
        },
        detach: () => source.detach(),
    });
}

async function installFixture(page: Page, path: string) {
    await page.goto(`${origin}/${path}`);
    await page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>("#increment")!;
        let count = 0;
        button.onclick = () => { button.textContent = `Clicks: ${++count}`; };
        setInterval(() => { document.querySelector("#clock")!.textContent = String(Date.now()); }, 100);
    });
}

async function capture(read: () => Promise<string>, file: string) {
    const started = performance.now();
    const reply = { data: await read() };
    assert(reply.data.length < 1024 * 1024, "Fixture screenshot exceeded bound");
    const bytes = Buffer.from(reply.data, "base64");
    assert.equal(bytes.readUInt32BE(16), 320);
    assert.equal(bytes.readUInt32BE(20), 160);
    await writeFile(resolve(output, file), bytes);
    return { sha256: createHash("sha256").update(bytes).digest("hex"), elapsedMs: performance.now() - started,
        data: reply.data };
}

async function assertOwnedPixels(page: Page, data: string) {
    const pixel = await page.evaluate(async (base64) => {
        const image = new Image(); image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 160;
        const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
        return [...context.getImageData(300, 140, 1, 1).data];
    }, data);
    assert.deepEqual(pixel, [49, 200, 133, 255], "Offscreen region did not contain the original target");
}

try {
    const profile = resolve(output, "browser-profile");
    ownedBrowser = spawn(chromium.executablePath(), ["--remote-debugging-port=0",
        `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"],
    { windowsHide: true, stdio: "ignore" });
    let launchError: Error | undefined;
    ownedBrowser.on("error", (error) => { launchError = error; });
    let port = 0;
    for (let attempt = 0; attempt < 100 && !port; attempt++) {
        if (launchError) throw launchError;
        try { port = Number((await readFile(resolve(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); }
        catch { await new Promise((done) => setTimeout(done, 100)); }
    }
    assert(Number.isInteger(port) && port > 0 && port < 65536, "Owned browser did not open its debugger");
    // Avoid Playwright's per-target focus overrides entirely. Disabling them on a
    // second CDP session does not undo overrides owned by Playwright's first session.
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        noDefaults: true, timeout: 10000,
    });
    const context = browser.contexts()[0]; assert(context);
    context.setDefaultTimeout(10000);
    const a = await context.newPage(); await installFixture(a, "a");
    const source = await context.newCDPSession(a);
    await source.send("Emulation.setDeviceMetricsOverride", {
        width: 800, height: 600, deviceScaleFactor: 1, mobile: false,
    });
    await source.send("Page.enable");
    const binding = await bindSession(source);
    const readRegion = binding.bind({ x: 40, y: 120, width: 320, height: 160 });
    const initial = await capture(readRegion, "initial.png");
    const b = await context.newPage(); await installFixture(b, "b"); await b.bringToFront();
    const other = await context.newCDPSession(b);
    checks.switchState = { a: await a.evaluate(() => ({ state: document.visibilityState, focused: document.hasFocus() })),
        b: await b.evaluate(() => ({ state: document.visibilityState, focused: document.hasFocus() })),
        aWindow: await source.send("Browser.getWindowForTarget"),
        bWindow: await other.send("Browser.getWindowForTarget") };
    await a.waitForFunction(() => document.hidden);
    await new Promise((done) => setTimeout(done, 2200));
    const switched = await capture(readRegion, "switched-tab.png");
    await assertOwnedPixels(b, switched.data);
    assert.notEqual(switched.sha256, initial.sha256, "Original tab did not produce a new image");
    assert.equal(await b.evaluate(() => document.visibilityState), "visible");
    assert.equal(await a.evaluate(() => document.visibilityState), "hidden");
    checks.tabBinding = { passed: true, captureMs: switched.elapsedMs };

    await a.evaluate(() => scrollTo(0, 1400));
    const scroll = await a.evaluate(() => ({ x: scrollX, y: scrollY,
        targetBottom: document.querySelector("#target")!.getBoundingClientRect().bottom }));
    assert.equal(scroll.y, 1400); assert(scroll.targetBottom < 0);
    await new Promise((done) => setTimeout(done, 2200));
    const scrolled = await capture(readRegion, "scrolled-out.png");
    await assertOwnedPixels(b, scrolled.data);
    assert.notEqual(scrolled.sha256, switched.sha256, "Offscreen content did not update");
    assert.equal(await a.evaluate(() => scrollY), 1400, "Capture disturbed the user's scroll position");
    checks.offscreenRegion = { passed: true, captureMs: scrolled.elapsedMs, scrollY: 1400 };

    // Ordinary DOM button only: not a claim that arbitrary controls accept synthetic input.
    await source.send("Runtime.evaluate", {
        expression: "document.querySelector('#increment').click()", returnByValue: true,
    });
    assert.equal(await a.locator("#increment").textContent(), "Clicks: 1");
    assert.equal(await b.locator("#increment").textContent(), "Clicks: 0");
    assert.equal(await a.evaluate(() => scrollY), 1400);
    assert.equal(await b.evaluate(() => document.visibilityState), "visible");
    const clicked = await capture(readRegion, "clicked-original.png");
    assert.notEqual(clicked.sha256, scrolled.sha256);
    checks.originalButtonOnly = true;
    await a.goto(`${origin}/replacement`);
    await assert.rejects(readRegion, /BROWSER_DOCUMENT_CHANGED/);
    await binding.close();
    checks.documentNavigationRejects = true;
    assert.equal(a.isClosed(), false, "Revoking a binding must not close the user's tab");
    const closingBinding = await bindSession(await context.newCDPSession(a));
    const closingRegion = closingBinding.bind({ x: 40, y: 120, width: 320, height: 160 });
    await a.close();
    await assert.rejects(closingRegion, /BROWSER_SOURCE_CLOSED/);
    await closingBinding.close();
    checks.sourceCloseRejects = true;
    passed = true;
} catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
} finally {
    try {
        try {
            if (browser?.isConnected()) {
                const control = await browser.newBrowserCDPSession();
                await control.send("Browser.close").catch(() => undefined);
            }
            await browser?.close();
        } finally {
            if (ownedBrowser && ownedBrowser.exitCode === null && ownedBrowser.pid) {
                await Promise.race([new Promise<void>((done) => ownedBrowser!.once("exit", () => done())),
                    new Promise<void>((done) => setTimeout(done, 5000))]);
                if (ownedBrowser.exitCode === null) {
                    const kill = spawn("taskkill", ["/PID", String(ownedBrowser.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
                    await new Promise<void>((done) => { kill.once("error", () => done()); kill.once("close", () => done()); });
                    checks.forcedOwnedCleanup = true;
                }
            }
            checks.browserClosed = !browser?.isConnected();
        }
    }
    finally {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
        checks.serverClosed = !server.listening;
        await writeFile(resolve(output, "summary.json"), JSON.stringify({ passed, failure, checks,
            limitations: ["Not integrated into Hook", "CDP screenshot, not tabCapture video",
                "Ordinary owned DOM button only", "No browser-extension permission or package-trust acceptance"] }, null, 2), "utf8");
        console.log(JSON.stringify({ output, passed, failure, checks }));
    }
}
