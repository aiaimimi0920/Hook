// A real, unencrypted browser video; no personal browser profile or global input.
import { chromium, type BrowserContext } from "playwright";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import assert from "node:assert/strict";
import { verifyVideoFixture, videoFixtureFilter } from "./live-video-fixture.ts";

const repo = resolve(import.meta.dirname, "../..");
const output = resolve(process.argv[2] ?? `${repo}/artifacts/live-browser-video-${Date.now()}`);
assert(output.startsWith(resolve(repo, "artifacts") + sep));
await mkdir(output, { recursive: false });
const title = `HookLiveVideoProbe-${randomUUID()}`;
const channel = process.env.HOOK_BROWSER_VIDEO_CHANNEL ?? "chrome";
assert(channel === "chrome" || channel === "msedge", "Only isolated Chrome or Edge fixtures are supported");
const video = resolve(output, "video.mp4");
async function run(command: string, args: string[], env = process.env) {
    let log = "";
    const child = spawn(command, args, { cwd: repo, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const append = (data: Buffer) => { log = (log + data.toString()).slice(-4 * 1024 * 1024); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
        // Only this owned process tree: cargo may have started the native test runner.
        if (process.platform === "win32" && child.pid) {
            const cleanup = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
            cleanup.on("error", () => child.kill());
        } else child.kill();
    }, 240000);
    try {
        const code = await new Promise<number | null>((resolve, reject) => {
            child.on("error", reject); child.on("close", resolve);
        });
        return { code, log };
    } finally { clearTimeout(timer); }
}
const generated = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
    videoFixtureFilter, "-t", "8", "-an", "-c:v", "libx264", "-preset", "ultrafast",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", video]);
assert.equal(generated.code, 0, generated.log);
const fixtureQuality = await verifyVideoFixture(video);
await writeFile(resolve(output, "fixture-quality.json"), JSON.stringify(fixtureQuality, null, 2), "utf8");
const videoBytes = (await stat(video)).size;
const server = createServer((request, response) => {
    if (request.url === "/video.mp4") {
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), videoBytes - 1) : videoBytes - 1;
        if (start > end || start >= videoBytes) { response.writeHead(416).end(); return; }
        response.writeHead(range ? 206 : 200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes",
            "Content-Length": end - start + 1, ...(range ? { "Content-Range": `bytes ${start}-${end}/${videoBytes}` } : {}) });
        createReadStream(video, { start, end }).pipe(response);
    } else {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html>
<title>${title}</title><style>body{margin:0;background:#29c278;color:#111;font:24px sans-serif}
header{height:60px;background:#ffe16b}video{display:block;width:100%;height:auto}</style>
<header>Owned video capture fixture / UI must stay visible</header>
<video autoplay muted loop playsinline src="/video.mp4"></video><button>Ordinary UI control</button>`);
    }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}`;
let context: BrowserContext | undefined;
try {
    context = await chromium.launchPersistentContext(resolve(output, "browser-profile"), {
        channel, headless: false, viewport: null, chromiumSandbox: true,
        ignoreDefaultArgs: ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling"],
        args: [`--app=${url}`, "--window-position=40,100", "--window-size=800,660", "--autoplay-policy=no-user-gesture-required"],
    });
    const page = context.pages()[0] ?? await context.newPage();
    const media = await context.newCDPSession(page);
    const decoder: Record<string, string> = {};
    media.on("Media.playerPropertiesChanged", ({ properties }: { properties: { name: string; value: string }[] }) => {
        for (const property of properties) {
            if (/decoder|platformvideo/i.test(property.name)) decoder[property.name] = property.value;
        }
    });
    await media.send("Media.enable");
    await page.goto(url);
    await page.waitForFunction(() => {
        const video = document.querySelector("video"); return video && video.readyState >= 3 && video.currentTime > 0;
    });
    const quality = () => page.evaluate(() => {
        const v = document.querySelector("video")!; const q = v.getVideoPlaybackQuality();
        return { currentTime: v.currentTime, decoded: q.totalVideoFrames, dropped: q.droppedVideoFrames };
    });
    const before = await quality();
    await page.screenshot({ path: resolve(output, "browser-oracle.png") });
    const result = await run("cargo", ["test", "--offline", "--manifest-path", "src-tauri/Cargo.toml",
        "--lib", process.env.HOOK_BROWSER_VIDEO_MULTI === "1" ? "multi_live_tests" : "browser_video_tests",
        "--", "--ignored", "--nocapture", "--test-threads=1"], {
        ...process.env, HOOK_BROWSER_VIDEO_TITLE: title, HOOK_BROWSER_VIDEO_OUTPUT: output,
        HOOK_CAPTURE_AREA_VERBOSE_LOG: "1", HOOK_LOG_DIR: resolve(output, "logs"),
    });
    await writeFile(resolve(output, "native.log"), result.log, "utf8");
    let after: Awaited<ReturnType<typeof quality>> | null = null;
    let qualityError: string | null = null;
    try { after = await quality(); }
    catch (error) { qualityError = String(error).slice(0, 1000); }
    const evidence = { output, channel, before, after, qualityError, decoder, nativeExit: result.code };
    await writeFile(resolve(output, "browser.json"), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
    // A closed fixture must not hide the native failure that preceded telemetry.
    assert.equal(result.code, 0, result.log.slice(-1800));
    assert(after, qualityError ?? "Source video telemetry unavailable");
    assert(after.decoded - before.decoded > 180, "Source video did not advance sufficiently");
    assert.equal(decoder.kIsPlatformVideoDecoder, "true", "Hardware video decoding is required for this probe");
    console.log(await readFile(resolve(output, "native-summary.json"), "utf8"));
} finally {
    try { await context?.close(); }
    finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}
