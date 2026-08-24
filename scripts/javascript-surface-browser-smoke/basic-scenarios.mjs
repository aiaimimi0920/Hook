/* global MessageChannel, window */

import { Buffer } from "node:buffer";

export const surfaceSnapshot = {
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

const validateScenario = (name, result, expectedFailure) => {
    if (expectedFailure) {
        if (result.outcome.kind !== "failure" || !result.outcome.message.includes(expectedFailure)) {
            throw new Error(`${name} did not fail with ${expectedFailure}: ${JSON.stringify(result)}`);
        }
        return;
    }
    if (result.outcome.kind !== "heartbeat") {
        throw new Error(`${name} did not publish a healthy heartbeat: ${JSON.stringify(result)}`);
    }
    const budget = result.outcome.budget;
    if (!budget?.capabilities?.heap || !budget?.capabilities?.longTask) {
        throw new Error(`${name} did not expose Chromium heap/long-task telemetry: ${JSON.stringify(budget)}`);
    }
};

export const createScenarioRunner = ({ page, surfaceHostUrl, snapshot, eventRecorder }) => {
    const runScenario = async (name, source, expectedFailure) => {
        eventRecorder.reset();
        const entryBase64 = Buffer.from(source, "utf8").toString("base64");
        const result = await page.evaluate(
            async ({ surfaceHostUrl, entryBase64, snapshot, expectedFailure }) => {
                const iframe = window.document.createElement("iframe");
                iframe.setAttribute("sandbox", "allow-scripts");
                const messages = [];
                const token = "surface-token-browser-smoke";
                let channel;
                let timeout;
                try {
                    const outcome = await new Promise((resolve) => {
                        let settled = false;
                        const finish = (value) => {
                            if (settled) return;
                            settled = true;
                            window.clearTimeout(timeout);
                            resolve(value);
                        };
                        timeout = window.setTimeout(() => finish({ kind: "timeout" }), 30_000);
                        iframe.addEventListener("load", () => {
                            channel = new MessageChannel();
                            channel.port1.onmessage = (event) => {
                                messages.push(event.data);
                                if (messages.length > 1024) messages.splice(0, messages.length - 1024);
                                const message = event.data;
                                if (message?.type === "failure") {
                                    finish({ kind: "failure", message: String(message.message || "") });
                                } else if (!expectedFailure && message?.type === "heartbeat") {
                                    channel.port1.postMessage({ type: "dispose", token });
                                    finish({ kind: "heartbeat", budget: message.budget });
                                }
                            };
                            channel.port1.start();
                            iframe.contentWindow.postMessage({
                                type: "surface:init",
                                token,
                                entryBase64,
                                snapshot,
                                resources: {},
                            }, "*", [channel.port2]);
                        }, { once: true });
                        iframe.src = surfaceHostUrl;
                        window.document.body.replaceChildren(iframe);
                    });
                    return { outcome, messageTypes: messages.map((message) => message?.type) };
                } finally {
                    window.clearTimeout(timeout);
                    try { channel?.port1.postMessage({ type: "dispose", token }); } catch {}
                    channel?.port1.close();
                    iframe.remove();
                }
            },
            { surfaceHostUrl, entryBase64, snapshot, expectedFailure },
        );
        result.frameUrls = page.frames().map((frame) => frame.url());
        result.browserEvents = eventRecorder.snapshot();
        validateScenario(name, result, expectedFailure);
        return { name, expectedFailure: expectedFailure || null, ...result };
    };

    const runStrayMessageScenario = async () => {
        eventRecorder.reset();
        const source = "NeuroSurface.define({ mount({ root }) { root.textContent = 'ready'; } });";
        const entryBase64 = Buffer.from(source, "utf8").toString("base64");
        const result = await page.evaluate(
            async ({ surfaceHostUrl, entryBase64, snapshot }) => {
                const iframe = window.document.createElement("iframe");
                iframe.setAttribute("sandbox", "allow-scripts");
                const messages = [];
                const token = "surface-token-stray-message";
                let channel;
                let timeout;
                try {
                    const outcome = await new Promise((resolve) => {
                        let settled = false;
                        const finish = (value) => {
                            if (settled) return;
                            settled = true;
                            window.clearTimeout(timeout);
                            resolve(value);
                        };
                        timeout = window.setTimeout(() => finish({ kind: "timeout" }), 30_000);
                        iframe.addEventListener("load", () => {
                            channel = new MessageChannel();
                            channel.port1.onmessage = (event) => {
                                messages.push(event.data);
                                if (messages.length > 1024) messages.splice(0, messages.length - 1024);
                                const message = event.data;
                                if (message?.type === "failure") {
                                    finish({ kind: "failure", message: String(message.message || "") });
                                } else if (message?.type === "heartbeat") {
                                    channel.port1.postMessage({ type: "dispose", token });
                                    finish({ kind: "heartbeat", budget: message.budget });
                                }
                            };
                            channel.port1.start();
                            iframe.contentWindow.postMessage({ type: "surface:stray" }, "*");
                            iframe.contentWindow.postMessage({ type: "surface:init", token, entryBase64, snapshot, resources: {} }, "*");
                            iframe.contentWindow.postMessage(
                                { type: "surface:init", token, entryBase64, snapshot, resources: {} },
                                "*",
                                [channel.port2],
                            );
                        }, { once: true });
                        iframe.src = surfaceHostUrl;
                        window.document.body.replaceChildren(iframe);
                    });
                    return { outcome, messageTypes: messages.map((message) => message?.type) };
                } finally {
                    window.clearTimeout(timeout);
                    try { channel?.port1.postMessage({ type: "dispose", token }); } catch {}
                    channel?.port1.close();
                    iframe.remove();
                }
            },
            { surfaceHostUrl, entryBase64, snapshot },
        );
        result.frameUrls = page.frames().map((frame) => frame.url());
        result.browserEvents = eventRecorder.snapshot();
        if (result.outcome.kind !== "heartbeat") {
            throw new Error(`stray-message did not survive a pre-init message: ${JSON.stringify(result)}`);
        }
        return { name: "stray-message", expectedFailure: null, ...result };
    };

    return { runScenario, runStrayMessageScenario };
};
