// Isolated real Chromium video and DOM oracle; all clicks come from native Otter input.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const repo = resolve(import.meta.dirname, '../..');
assert(process.argv[2], 'An unused evidence directory is required');
const output = resolve(process.argv[2]);
await mkdir(output, { recursive: false });
const title = `OtterLiveInputProbe-${randomUUID()}`;
let page;
const observations = [];
const server = createServer(async (request, response) => {
    try {
        if (request.url === '/oracle') {
            const state = await page.evaluate(() => {
                const v = document.querySelector('video');
                const b = document.querySelector('button').getBoundingClientRect();
                const r = v.getBoundingClientRect();
                return { paused: v.paused, clicks: Number(document.body.dataset.clicks ?? 0),
                    currentTime: v.currentTime, innerWidth, innerHeight, dpr: devicePixelRatio,
                    x: b.x + b.width / 2, y: b.y + b.height / 2,
                    left: r.left, top: r.top, width: r.width, height: r.height };
            });
            if (observations.length < 500) observations.push(state);
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(state));
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html>
<title>${title}</title><style>body{margin:0;background:#234}video{width:600px;height:400px}
button{position:absolute;left:20px;top:330px;width:140px;height:50px}</style>
<video autoplay muted playsinline></video><button>Play / pause</button><script>
const canvas = document.createElement('canvas'); canvas.width=600; canvas.height=400;
const c=canvas.getContext('2d'); let frame=0;
setInterval(()=>{c.fillStyle=++frame%2?'#49b':'#b94';c.fillRect(0,0,600,400);c.fillStyle='white';c.font='40px sans-serif';c.fillText(String(frame),100,180)},100);
const video=document.querySelector('video'); video.srcObject=canvas.captureStream(10);
document.querySelector('button').onclick=()=>{document.body.dataset.clicks=String(Number(document.body.dataset.clicks??0)+1);if(video.paused)video.play();else video.pause()};
</script>`);
    } catch (error) { response.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let browser;
try {
    browser = await chromium.launch({ channel: 'chrome', headless: false, chromiumSandbox: true,
        ignoreDefaultArgs: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling'],
        args: ['--window-position=40,100', '--window-size=900,760'] });
    const context = await browser.newContext({ viewport: null });
    page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(() => document.querySelector('video').currentTime > 0);
    const cdp = await browser.newBrowserCDPSession();
    const processes = await cdp.send('SystemInfo.getProcessInfo');
    const pid = processes.processInfo.find(p => p.type === 'browser').id;
    await writeFile(resolve(output, 'ready.json'), JSON.stringify({ title, pid, port }));
    const child = spawn('cargo', ['test', '--offline', '--manifest-path', 'src-tauri/Cargo.toml', '--lib',
        'live_browser_input_tests', '--', '--ignored', '--nocapture', '--test-threads=1'], {
        cwd: repo, env: { ...process.env, HOOK_BROWSER_INPUT_FIXTURE: resolve(output, 'ready.json') },
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const append = chunk => { log = (log + chunk).slice(-2 * 1024 * 1024); process.stdout.write(chunk); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => {
        if (child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    }, 240000);
    let code;
    try { code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); }
    finally { clearTimeout(timer); }
    await writeFile(resolve(output, 'native.log'), log);
    await writeFile(resolve(output, 'oracle.json'), JSON.stringify(observations, null, 2));
    assert.equal(code, 0, 'Native browser input regression failed');
} finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}
