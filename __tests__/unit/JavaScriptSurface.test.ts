import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
    JAVASCRIPT_SURFACE_BUDGETS,
    cloneSurfaceJson,
    consumeJavaScriptSurfaceEventBudget,
    javaScriptSurfaceHeartbeatStatus,
    javaScriptSurfaceRecoveryUrl,
    resolveJavaScriptSurfaceFrameGeometry,
    resolveJavaScriptSurfaceFramePoint,
    javaScriptSurfaceBudgetFailure,
    javaScriptSurfaceResourceBudgetFailure,
    parseJavaScriptSurfaceDataUrl,
    validateJavaScriptSurfaceHostDragPointer,
    validateJavaScriptSurfaceHostDragStart,
    validateJavaScriptSurfaceHostKeydown,
    validateJavaScriptSurfaceHostWheel,
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
        expect(bootstrap).toContain("nativeClearInterval");
        expect(bootstrap).toContain('message.type === "pointer"');
        expect(bootstrap).toContain("dispatchSyntheticPointer(message.pointer)");
        expect(bootstrap).toContain('type: "host-keydown"');
        expect(bootstrap).toContain('type: "host-activate"');
        expect(bootstrap).toContain('type: "host-drag-start"');
        expect(bootstrap).toContain('type: "host-drag-move"');
        expect(bootstrap).toContain('type: "host-drag-end"');
        expect(bootstrap).toContain('type: "host-wheel"');
        expect(bootstrap).toContain('message.type === "release-editable-focus"');
        expect(bootstrap).toContain('message.type === "restore-editable-focus"');
        expect(bootstrap).toContain('port.postMessage({ type: "host-activate", token })');
        expect(bootstrap).toContain('document.addEventListener("pointercancel", notifyHostPointerEnd, true)');
        expect(bootstrap).toContain('document.addEventListener("wheel", notifyHostWheel, { capture: true, passive: false })');
        expect(bootstrap).toContain("isInteractiveTarget(event.target)");
        expect(bootstrap).toContain('if (event.key !== "Escape") return;');
        expect(bootstrap).toContain("event.defaultPrevented || event.cancelBubble");
        expect(bootstrap).toContain("nativeSetTimeout(() =>");
        expect(bootstrap).toContain("event.isTrusted");
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

    it("gives an active iframe a recovery window before declaring it stalled", () => {
        expect(javaScriptSurfaceHeartbeatStatus({
            now: 4_000,
            lastHeartbeat: 0,
            lastWatchdogTick: 3_500,
            documentVisible: true,
            lifecycle: "active",
        })).toBe("recovering");
        expect(javaScriptSurfaceHeartbeatStatus({
            now: 4_000,
            lastHeartbeat: 0,
            lastWatchdogTick: 3_500,
            documentVisible: true,
            lifecycle: "mounted",
        })).toBe("recovering");
        expect(javaScriptSurfaceHeartbeatStatus({
            now: 31_000,
            lastHeartbeat: 0,
            lastWatchdogTick: 30_500,
            documentVisible: true,
            lifecycle: "active",
        })).toBe("expired");
        expect(javaScriptSurfaceHeartbeatStatus({
            now: 4_000,
            lastHeartbeat: 0,
            lastWatchdogTick: 0,
            documentVisible: true,
            lifecycle: "active",
        })).toBe("paused");
        expect(javaScriptSurfaceHeartbeatStatus({
            now: 4_000,
            lastHeartbeat: 0,
            lastWatchdogTick: 3_500,
            documentVisible: false,
            lifecycle: "active",
        })).toBe("paused");
        expect(javaScriptSurfaceHeartbeatStatus({
            now: 4_000,
            lastHeartbeat: 0,
            lastWatchdogTick: 3_500,
            documentVisible: true,
            lifecycle: "suspended",
        })).toBe("paused");
        expect(javaScriptSurfaceHeartbeatStatus({
            now: 2_500,
            lastHeartbeat: 0,
            lastWatchdogTick: 2_000,
            documentVisible: true,
            lifecycle: "active",
        })).toBe("healthy");
    });

    it("creates a distinct same-origin URL for each watchdog recovery", () => {
        expect(javaScriptSurfaceRecoveryUrl(
            "http://tauri.localhost/javascript-surface-host.html",
            2,
        )).toBe("http://tauri.localhost/javascript-surface-host.html?surface-recovery=2");
        expect(javaScriptSurfaceRecoveryUrl(
            "http://tauri.localhost/javascript-surface-host.html?mode=test",
            3,
        )).toBe("http://tauri.localhost/javascript-surface-host.html?mode=test&surface-recovery=3");
    });

    it("measures the final iframe transform instead of trusting only the Art view scale", () => {
        const frame = document.createElement("iframe");
        Object.defineProperty(frame, "clientWidth", { configurable: true, value: 960 });
        Object.defineProperty(frame, "clientHeight", { configurable: true, value: 820 });
        frame.getBoundingClientRect = () => ({
            x: 12,
            y: 24,
            left: 12,
            top: 24,
            right: 492,
            bottom: 434,
            width: 480,
            height: 410,
            toJSON: () => ({}),
        } as DOMRect);

        const geometry = resolveJavaScriptSurfaceFrameGeometry(frame, 1);

        expect(geometry.scaleX).toBe(0.5);
        expect(geometry.scaleY).toBe(0.5);
        expect(geometry.localWidth).toBe(960);
        expect(geometry.localHeight).toBe(820);
        expect(resolveJavaScriptSurfaceFramePoint(geometry, 252, 229)).toEqual({
            x: 480,
            y: 410,
            normalizedX: 0.5,
            normalizedY: 0.5,
        });
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

    it("accepts only bounded host keydown payloads from the sandbox bridge", () => {
        expect(validateJavaScriptSurfaceHostKeydown({
            key: "e",
            code: "KeyE",
            repeat: false,
            ctrlKey: true,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        })).toBe(true);
        expect(validateJavaScriptSurfaceHostKeydown({
            key: "x".repeat(65),
            code: "KeyX",
            repeat: false,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        })).toBe(false);
        expect(validateJavaScriptSurfaceHostKeydown({
            key: "Tab",
            code: "Tab",
            repeat: "false",
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        })).toBe(false);
    });

    it("accepts only finite left-button drag coordinates from the sandbox bridge", () => {
        expect(validateJavaScriptSurfaceHostDragStart({
            gestureId: 7,
            x: 120,
            y: 80,
            normalizedX: 0.5,
            normalizedY: 0.25,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        })).toBe(true);
        expect(validateJavaScriptSurfaceHostDragStart({
            gestureId: 7,
            x: -1,
            y: 80,
            normalizedX: 0.5,
            normalizedY: 0.25,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        })).toBe(false);
        expect(validateJavaScriptSurfaceHostDragStart({
            gestureId: 0,
            x: 120,
            y: 80,
            normalizedX: 0.5,
            normalizedY: 0.25,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        })).toBe(false);
    });

    it("accepts bounded drag-stream metadata while allowing movement outside the iframe", () => {
        expect(validateJavaScriptSurfaceHostDragPointer({
            gestureId: 7,
            x: -20,
            y: 900,
            normalizedX: -0.1,
            normalizedY: 1.1,
            pointerId: 4,
            button: 0,
            buttons: 1,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        })).toBe(true);
        expect(validateJavaScriptSurfaceHostDragPointer({
            gestureId: 7,
            x: 20,
            y: 30,
            normalizedX: 0.1,
            normalizedY: 0.2,
            pointerId: -1,
            button: 0,
            buttons: 1,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        })).toBe(false);
        expect(validateJavaScriptSurfaceHostDragPointer({
            gestureId: Number.NaN,
            x: 20,
            y: 30,
            normalizedX: 0.1,
            normalizedY: 0.2,
            pointerId: 1,
            button: 0,
            buttons: 1,
            ctrlKey: false,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        })).toBe(false);
    });

    it("accepts bounded modifier-wheel payloads from a native-interactive iframe", () => {
        expect(validateJavaScriptSurfaceHostWheel({
            gestureId: 8,
            x: 120,
            y: 80,
            normalizedX: 0.5,
            normalizedY: 0.25,
            deltaY: -100,
            ctrlKey: true,
            altKey: false,
            shiftKey: false,
            metaKey: false,
        })).toBe(true);
        expect(validateJavaScriptSurfaceHostWheel({
            gestureId: 8,
            x: 120,
            y: 80,
            normalizedX: 0.5,
            normalizedY: 0.25,
            deltaY: Number.POSITIVE_INFINITY,
            ctrlKey: false,
            altKey: true,
            shiftKey: false,
            metaKey: false,
        })).toBe(false);
    });

    it("does not let an unready transparent iframe capture the fallback controls", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src/components/JavaScriptSurface.tsx"),
            "utf8",
        );
        expect(source).toContain(
            '"pointer-events": ready() && props.interactive !== false ? "auto" : "none"',
        );
        expect(source).toContain(
            "tabindex={ready() && props.interactive !== false ? 0 : -1}",
        );
        expect(source).toContain('data-javascript-surface-frame="true"');
        expect(source).toContain("JAVASCRIPT_SURFACE_POINTER_EVENT");
        expect(source).toContain('message.type === "host-keydown"');
        expect(source).toContain('message.type === "host-drag-start"');
        expect(source).toContain('message.type === "host-drag-move"');
        expect(source).toContain('message.type === "host-drag-end"');
        expect(source).toContain('message.type === "host-background-double-click"');
        expect(source).toContain('window.dispatchEvent(new MouseEvent(');
        expect(source).toContain("window.dispatchEvent(markSurfaceRelayedKeydown(new KeyboardEvent");
        expect(source).not.toContain('data-surface-drag-handle="true"');
        expect(source).not.toContain("javascript-surface-drag-handle");
        expect(source).toContain("EDITABLE_FOCUS_RELEASE_EVENT");
        expect(source).toContain('type: "release-editable-focus"');
        expect(source).toContain('type: "restore-editable-focus"');
        expect(source).toContain("const snapshotRevision = snapshot.revision;");
        expect(source).toContain("const snapshotViewId = snapshot.viewId;");
        expect(source).toContain(
            "const geometry = resolveJavaScriptSurfaceFrameGeometry(iframe, displayScale());",
        );
        expect(source).toContain("resolveJavaScriptSurfaceFrameGeometry");
        const snapshotRevisionIndex = source.indexOf("const snapshotRevision = snapshot.revision;");
        expect(snapshotRevisionIndex).toBeGreaterThan(-1);
        expect(snapshotRevisionIndex).toBeLessThan(
            source.indexOf("if (!port) return;", snapshotRevisionIndex),
        );
        expect(source).toContain("snapshotRevision,");

        const unitView = readFileSync(
            resolve(process.cwd(), "src/components/UnitView.tsx"),
            "utf8",
        );

        expect(unitView).toContain("onActivate={activateUnit}");
        expect(unitView).toContain("onDragStart={(event) => {");
        expect(unitView).toContain("blurActiveEditableOutside(unitContainerRef, props.unit.id)");
    });

    it("filters and throttles the sandbox keydown relay before it reaches the host", () => {
        const source = readFileSync(
            resolve(process.cwd(), "src/components/JavaScriptSurface.tsx"),
            "utf8",
        );
        const branchStart = source.indexOf('if (message.type === "host-keydown") {');
        expect(branchStart).toBeGreaterThan(-1);
        const branch = source.slice(
            branchStart,
            source.indexOf('if (message.type === "heartbeat") {', branchStart),
        );
        // Shape validation admits any key with any modifier combination, so the relay
        // needs the allowlist as well, and it must run before the budget so that
        // non-relayable spam is dropped without consuming the shared event budget.
        const validateIndex = branch.indexOf("validateJavaScriptSurfaceHostKeydown(message.keydown)");
        const allowlistIndex = branch.indexOf("isRelayableSurfaceHostKeydown(keydown)");
        const budgetIndex = branch.indexOf(
            "consumeJavaScriptSurfaceEventBudget(eventBudgetWindow, Date.now())",
        );
        const dispatchIndex = branch.indexOf("window.dispatchEvent(markSurfaceRelayedKeydown(");
        expect(validateIndex).toBeGreaterThanOrEqual(0);
        expect(allowlistIndex).toBeGreaterThan(validateIndex);
        expect(budgetIndex).toBeGreaterThan(allowlistIndex);
        expect(dispatchIndex).toBeGreaterThan(budgetIndex);
        expect(branch).toContain("if (!keydownBudget.allowed) return;");
        expect(branch).toContain("eventBudgetWindow = keydownBudget.window;");
    });
});
