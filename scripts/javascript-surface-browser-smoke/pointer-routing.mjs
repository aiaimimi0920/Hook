/* global MessageChannel, window */

import { Buffer } from "node:buffer";

import { assertPointerRoutingResult } from "./pointer-routing/assertions.mjs";
import {
    readPointerControls,
    runPointerInteractions,
} from "./pointer-routing/interactions.mjs";

const pointerSurfaceSource = `NeuroSurface.define({
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
        root.querySelector('#chart').getContext('2d').fillRect(0, 0, 240, 120);
    }
});`;

const cleanupPointerSurface = async (page) => {
    await page.evaluate(() => {
        const state = window.__surfacePointerSmoke;
        if (!state) return;
        try { state.channel.port1.postMessage({ type: "dispose", token: state.token }); } catch {}
        state.channel.port1.close();
        state.iframe.remove();
        delete window.__surfacePointerSmoke;
    }).catch(() => {});
};

const initializePointerSurface = async ({ page, surfaceHostUrl, entryBase64, snapshot }) => {
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
            channel.port1.onmessage = (event) => {
                messages.push(event.data);
                if (messages.length > 2048) messages.splice(0, messages.length - 2048);
            };
            channel.port1.start();
            window.__surfacePointerSmoke = { channel, iframe, messages, token };
            iframe.src = surfaceHostUrl;
            visual.append(iframe, annotationViewport);
            window.document.body.replaceChildren(visual);
            await new Promise((resolve, reject) => {
                const timeout = window.setTimeout(
                    () => reject(new Error("pointer-routing Surface iframe load timed out")),
                    60_000,
                );
                iframe.addEventListener("load", () => {
                    window.clearTimeout(timeout);
                    resolve();
                }, { once: true });
            });
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
};

export const runPointerRoutingScenario = async ({
    page,
    surfaceHostUrl,
    snapshot,
    eventRecorder,
}) => {
    eventRecorder.reset();
    const entryBase64 = Buffer.from(pointerSurfaceSource, "utf8").toString("base64");
    try {
        await initializePointerSurface({ page, surfaceHostUrl, entryBase64, snapshot });
        try {
            await page.waitForFunction(() => window.__surfacePointerSmoke?.messages.some(
                (message) => message?.type === "ready",
            ), undefined, { timeout: 180_000 });
        } catch (error) {
            const diagnostics = await page.evaluate(() => ({
                frameUrl: window.__surfacePointerSmoke?.iframe?.src,
                messageTypes: window.__surfacePointerSmoke?.messages?.map((message) => message?.type),
            })).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }));
            throw new Error(`pointer-routing Surface did not become ready: ${String(error)} ${JSON.stringify({ diagnostics, browserEvents: eventRecorder.snapshot() })}`);
        }
        const surfaceFrame = page.frames().find((frame) => frame.url() === surfaceHostUrl);
        if (!surfaceFrame) throw new Error("pointer-routing Surface frame is unavailable");
        const { controls, iframeBox } = await readPointerControls(page, surfaceFrame);
        const result = await runPointerInteractions({ page, surfaceFrame, controls, iframeBox });
        assertPointerRoutingResult(result, controls);
        return {
            name: "pointer-routing",
            expectedFailure: null,
            outcome: { kind: "interaction", ...result },
            browserEvents: eventRecorder.snapshot(),
        };
    } finally {
        await cleanupPointerSurface(page);
    }
};
