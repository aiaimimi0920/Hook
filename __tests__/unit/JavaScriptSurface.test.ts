import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
    JAVASCRIPT_SURFACE_BUDGETS,
    cloneSurfaceJson,
    consumeJavaScriptSurfaceEventBudget,
    javaScriptSurfaceBudgetFailure,
    javaScriptSurfaceResourceBudgetFailure,
    parseJavaScriptSurfaceDataUrl,
    validateJavaScriptSurfaceEvent,
} from "../../src/components/JavaScriptSurface";
import {
    SURFACE_PROTOCOL_VERSION,
    type SurfaceSnapshot,
} from "../../src/services/surfaceProtocol";

const snapshot = (): SurfaceSnapshot => ({
    protocolVersion: SURFACE_PROTOCOL_VERSION,
    instanceId: "instance:javascript",
    attachmentId: "attachment:javascript",
    artId: "NA00000000001",
    artVersion: "1.0.0",
    revision: 1,
    runtime: "javascript",
    entryResourceId: `sha256:${"a".repeat(64)}`,
    scene: {
        id: "root",
        type: "column",
        children: [{
            id: "refresh",
            type: "button",
            events: { click: "refresh_price" },
        }],
    },
});

describe("JavaScript Surface sandbox contract", () => {
    it("normalizes store-like proxies before crossing the iframe message boundary", () => {
        const proxy = new Proxy(snapshot(), {});
        expect(cloneSurfaceJson(proxy)).toEqual(snapshot());
    });

    it("accepts only bounded application/javascript resources", () => {
        expect(parseJavaScriptSurfaceDataUrl(
            "data:application/javascript;base64,Y29uc29sZS5sb2coMSk=",
        )).toEqual({
            base64: "Y29uc29sZS5sb2coMSk=",
            byteLength: 14,
        });
        expect(parseJavaScriptSurfaceDataUrl(
            "data:text/javascript;base64,Y29uc29sZS5sb2coMSk=",
        )).toBeUndefined();
        expect(parseJavaScriptSurfaceDataUrl("https://example.invalid/main.js")).toBeUndefined();
    });

    it("ships a no-network, no-inline static sandbox host", () => {
        const document = readFileSync(
            resolve(process.cwd(), "public/javascript-surface-host.html"),
            "utf8",
        );
        const bootstrap = readFileSync(
            resolve(process.cwd(), "public/javascript-surface-bootstrap.js"),
            "utf8",
        );
        expect(document).toContain("default-src 'none'");
        expect(document).toContain("connect-src 'none'");
        expect(document).toContain("worker-src 'none'");
        expect(document).toContain("script-src 'self' blob:");
        expect(document).toContain('src="/javascript-surface-bootstrap.js"');
        expect(document).not.toContain("<script>");
        expect(document).not.toContain("unsafe-eval");
        expect(bootstrap).toContain("Surface DOM node budget exceeded");
        expect(bootstrap).toContain("Surface timer budget exceeded");
        expect(bootstrap).toContain("Surface memory budget exceeded");
        expect(bootstrap).toContain("Surface CPU budget exceeded");
        expect(bootstrap).toContain("longTaskTelemetryAvailable");
        expect(bootstrap).toContain("heapGrowthBytes !== null");
        expect(bootstrap).toContain('entryTypes: ["longtask"]');
        expect(bootstrap).toContain("entry.startTime >= cpuWindowStartedAt");
        expect(bootstrap).toContain("performance.now() + CPU_WARMUP_MILLIS");
        expect(bootstrap).toContain("nativeClearInterval");
    });

    it("enforces host-side CPU, memory, DOM, timer, resource, and event budgets", () => {
        const healthy = {
            capabilities: { heap: true, longTask: true },
            heapGrowthBytes: 1024,
            cpuWindowMillis: 5,
            domNodes: 10,
            timers: 2,
        };
        expect(javaScriptSurfaceBudgetFailure(healthy)).toBeUndefined();
        expect(javaScriptSurfaceBudgetFailure({
            capabilities: { heap: false, longTask: false },
            heapGrowthBytes: null,
            cpuWindowMillis: null,
            domNodes: 10,
            timers: 2,
        })).toBeUndefined();
        expect(javaScriptSurfaceBudgetFailure(undefined)).toContain("telemetry");
        expect(javaScriptSurfaceBudgetFailure({
            ...healthy,
            heapGrowthBytes: null,
        })).toContain("heap telemetry");
        expect(javaScriptSurfaceBudgetFailure({
            ...healthy,
            cpuWindowMillis: null,
        })).toContain("CPU telemetry");
        expect(javaScriptSurfaceBudgetFailure({
            ...healthy,
            heapGrowthBytes: JAVASCRIPT_SURFACE_BUDGETS.maxHeapGrowthBytes + 1,
        })).toContain("memory budget");
        expect(javaScriptSurfaceBudgetFailure({
            ...healthy,
            cpuWindowMillis: JAVASCRIPT_SURFACE_BUDGETS.maxCpuWindowMillis + 1,
        })).toContain("CPU budget");
        expect(javaScriptSurfaceBudgetFailure({
            ...healthy,
            domNodes: JAVASCRIPT_SURFACE_BUDGETS.maxDomNodes + 1,
        })).toContain("DOM node budget");
        expect(javaScriptSurfaceBudgetFailure({
            ...healthy,
            timers: JAVASCRIPT_SURFACE_BUDGETS.maxTimers + 1,
        })).toContain("timer budget");

        const excessiveResources = Object.fromEntries(
            Array.from(
                { length: JAVASCRIPT_SURFACE_BUDGETS.maxResourceEntries + 1 },
                (_, index) => [`sha256:${index.toString(16).padStart(64, "0")}`, "blob:test"],
            ),
        );
        expect(javaScriptSurfaceResourceBudgetFailure(excessiveResources)).toContain("count budget");

        let window = { windowStartedAt: 0, count: 0 };
        for (let index = 0; index < JAVASCRIPT_SURFACE_BUDGETS.maxEventsPerSecond; index += 1) {
            const result = consumeJavaScriptSurfaceEventBudget(window, 100);
            expect(result.allowed).toBe(true);
            window = result.window;
        }
        const rejected = consumeJavaScriptSurfaceEventBudget(window, 100);
        expect(rejected.allowed).toBe(false);
        const reset = consumeJavaScriptSurfaceEventBudget(rejected.window, 1_100);
        expect(reset.allowed).toBe(true);
        expect(reset.window.count).toBe(1);
    });

    it("forwards only actions declared by the current authoritative scene", () => {
        expect(validateJavaScriptSurfaceEvent(snapshot(), {
            nodeId: "refresh",
            event: "click",
            action: "refresh_price",
            class: "discrete",
            payload: { source: "button" },
        })).toBe(true);
        expect(validateJavaScriptSurfaceEvent(snapshot(), {
            nodeId: "refresh",
            event: "click",
            action: "undeclared_action",
            class: "discrete",
        })).toBe(false);
        expect(validateJavaScriptSurfaceEvent(snapshot(), {
            nodeId: "refresh",
            event: "click",
            action: "refresh_price",
            class: "local",
        })).toBe(false);
    });
});
