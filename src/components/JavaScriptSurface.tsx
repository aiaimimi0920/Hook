import {
    Component,
    Show,
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
} from "solid-js";

import {
    SURFACE_PROTOCOL_VERSION,
    type SurfaceEvent,
    type SurfaceEventClass,
    type SurfaceLifecycleState,
    type SurfaceNode,
    type SurfaceSnapshot,
} from "../services/surfaceProtocol";
import { DeclarativeSurface } from "./DeclarativeSurface";
import "./JavaScriptSurface.css";

const MAX_JAVASCRIPT_SOURCE_BYTES = 512 * 1024;
const WATCHDOG_MILLIS = 3_000;
const SAFE_ID = /^[A-Za-z0-9._:/-]{1,160}$/;

/** Normalize Solid store proxies before crossing a postMessage boundary. */
export function cloneSurfaceJson<T>(value: T): T {
    try {
        return structuredClone(value);
    } catch {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
            throw new Error("JavaScript Surface message is not JSON-serializable");
        }
        return JSON.parse(serialized) as T;
    }
}

export const JAVASCRIPT_SURFACE_BUDGETS = Object.freeze({
    maxEventPayloadBytes: 64 * 1024,
    maxEventsPerSecond: 120,
    maxHeapGrowthBytes: 64 * 1024 * 1024,
    maxCpuWindowMillis: 250,
    maxDomNodes: 1_000,
    maxTimers: 64,
    maxResourceEntries: 64,
    maxResourceTransferBytes: 64 * 1024 * 1024,
});

export interface JavaScriptSurfaceBudgetSample {
    capabilities: {
        heap: boolean;
        longTask: boolean;
    };
    heapGrowthBytes: number | null;
    cpuWindowMillis: number | null;
    domNodes: number;
    timers: number;
}

export interface JavaScriptSurfaceEventBudgetWindow {
    windowStartedAt: number;
    count: number;
}

export const consumeJavaScriptSurfaceEventBudget = (
    current: JavaScriptSurfaceEventBudgetWindow,
    now: number,
): { allowed: boolean; window: JavaScriptSurfaceEventBudgetWindow } => {
    const window = now < current.windowStartedAt || now - current.windowStartedAt >= 1_000
        ? { windowStartedAt: now, count: 0 }
        : current;
    const next = { ...window, count: window.count + 1 };
    return {
        allowed: next.count <= JAVASCRIPT_SURFACE_BUDGETS.maxEventsPerSecond,
        window: next,
    };
};

const finiteBudgetMetric = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;

export const javaScriptSurfaceBudgetFailure = (
    sample: JavaScriptSurfaceBudgetSample | undefined,
): string | undefined => {
    if (
        !sample ||
        !sample.capabilities ||
        typeof sample.capabilities.heap !== "boolean" ||
        typeof sample.capabilities.longTask !== "boolean" ||
        !finiteBudgetMetric(sample.domNodes) ||
        !finiteBudgetMetric(sample.timers)
    ) {
        return "JavaScript Surface budget telemetry is unavailable";
    }
    if (
        sample.capabilities.heap
        && !finiteBudgetMetric(sample.heapGrowthBytes)
    ) {
        return "JavaScript Surface heap telemetry is invalid";
    }
    if (
        sample.capabilities.longTask
        && !finiteBudgetMetric(sample.cpuWindowMillis)
    ) {
        return "JavaScript Surface CPU telemetry is invalid";
    }
    if (
        sample.capabilities.heap
        && sample.heapGrowthBytes !== null
        && sample.heapGrowthBytes > JAVASCRIPT_SURFACE_BUDGETS.maxHeapGrowthBytes
    ) {
        return "JavaScript Surface memory budget exceeded";
    }
    if (
        sample.capabilities.longTask
        && sample.cpuWindowMillis !== null
        && sample.cpuWindowMillis > JAVASCRIPT_SURFACE_BUDGETS.maxCpuWindowMillis
    ) {
        return "JavaScript Surface CPU budget exceeded";
    }
    if (sample.domNodes > JAVASCRIPT_SURFACE_BUDGETS.maxDomNodes) {
        return "JavaScript Surface DOM node budget exceeded";
    }
    if (sample.timers > JAVASCRIPT_SURFACE_BUDGETS.maxTimers) {
        return "JavaScript Surface timer budget exceeded";
    }
    return undefined;
};

export const javaScriptSurfaceResourceBudgetFailure = (
    resources: Readonly<Record<string, string>>,
): string | undefined => {
    const entries = Object.entries(resources);
    if (entries.length > JAVASCRIPT_SURFACE_BUDGETS.maxResourceEntries) {
        return "JavaScript Surface resource count budget exceeded";
    }
    let bytes = 0;
    const encoder = new TextEncoder();
    for (const [resourceId, resource] of entries) {
        bytes += encoder.encode(resourceId).byteLength;
        bytes += encoder.encode(resource).byteLength;
        if (bytes > JAVASCRIPT_SURFACE_BUDGETS.maxResourceTransferBytes) {
            return "JavaScript Surface resource memory budget exceeded";
        }
    }
    return undefined;
};

interface Props {
    unitId: string;
    snapshot: SurfaceSnapshot;
    generation: number;
    lifecycle: SurfaceLifecycleState;
    interactive?: boolean;
    resolveResource: (resourceId: string) => string | undefined;
    onEvent: (event: SurfaceEvent) => void;
}

interface ParsedJavaScriptResource {
    base64: string;
    byteLength: number;
}

interface JavaScriptSurfaceEventRequest {
    nodeId?: unknown;
    event?: unknown;
    action?: unknown;
    class?: unknown;
    payload?: unknown;
}

interface JavaScriptSurfaceValidatedEventRequest extends JavaScriptSurfaceEventRequest {
    nodeId: string;
    event: string;
    action: string;
    class: Exclude<SurfaceEventClass, "local">;
}

type RuntimeMessage =
    | { type: "ready"; token: string }
    | { type: "heartbeat"; token: string; budget?: JavaScriptSurfaceBudgetSample }
    | { type: "failure"; token: string; message?: unknown }
    | { type: "event"; token: string; event?: JavaScriptSurfaceEventRequest };

const base64DecodedLength = (base64: string): number => {
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - padding;
};

export const parseJavaScriptSurfaceDataUrl = (
    dataUrl: string | undefined,
): ParsedJavaScriptResource | undefined => {
    if (!dataUrl) return undefined;
    const match = /^data:application\/javascript;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) return undefined;
    const byteLength = base64DecodedLength(match[1]);
    if (byteLength <= 0 || byteLength > MAX_JAVASCRIPT_SOURCE_BYTES) return undefined;
    return { base64: match[1], byteLength };
};

const findNode = (root: SurfaceNode, nodeId: string): SurfaceNode | undefined => {
    if (root.id === nodeId) return root;
    for (const child of root.children ?? []) {
        const found = findNode(child, nodeId);
        if (found) return found;
    }
    return undefined;
};

export const validateJavaScriptSurfaceEvent = (
    snapshot: SurfaceSnapshot,
    request: JavaScriptSurfaceEventRequest,
): request is JavaScriptSurfaceValidatedEventRequest => {
    if (
        typeof request.nodeId !== "string" ||
        typeof request.event !== "string" ||
        typeof request.action !== "string" ||
        !SAFE_ID.test(request.nodeId) ||
        !SAFE_ID.test(request.event) ||
        !SAFE_ID.test(request.action) ||
        !["discrete", "continuous", "commit"].includes(String(request.class))
    ) {
        return false;
    }
    const node = findNode(snapshot.scene, request.nodeId);
    if (node?.events?.[request.event] !== request.action) return false;
    try {
        return new TextEncoder().encode(JSON.stringify(request.payload ?? null)).byteLength
            <= JAVASCRIPT_SURFACE_BUDGETS.maxEventPayloadBytes;
    } catch {
        return false;
    }
};

const htmlEscape = (value: string): string => value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const buildJavaScriptSurfaceDocument = (entryBase64: string, nonce: string): string => {
    const bootstrap = `
(() => {
  "use strict";
  const ENTRY_BASE64 = "${entryBase64}";
  const MAX_TIMERS = ${JAVASCRIPT_SURFACE_BUDGETS.maxTimers};
  const MAX_DOM_NODES = ${JAVASCRIPT_SURFACE_BUDGETS.maxDomNodes};
  const MAX_HEAP_GROWTH_BYTES = ${JAVASCRIPT_SURFACE_BUDGETS.maxHeapGrowthBytes};
  const MAX_CPU_WINDOW_MILLIS = ${JAVASCRIPT_SURFACE_BUDGETS.maxCpuWindowMillis};
  const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
  const nativeSetInterval = globalThis.setInterval.bind(globalThis);
  const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const nativeClearInterval = globalThis.clearInterval.bind(globalThis);
  const timers = new Map();
  let moduleDefinition = null;
  let mountCleanup = null;
  let port = null;
  let token = null;
  let context = null;
  let heartbeatId = null;
  let longTaskObserver = null;
  let longTaskTelemetryAvailable = false;
  let cpuWindowStartedAt = performance.now();
  let cpuWindowMillis = 0;
  let started = false;
  let disposed = false;

  const readHeapBytes = () => {
    const value = globalThis.performance?.memory?.usedJSHeapSize;
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const heapBaselineBytes = readHeapBytes();

  const fail = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (port && token) port.postMessage({ type: "failure", token, message });
  };
  const wrapTimer = (nativeCreate, nativeClear, repeat) => (callback, delay = 0, ...args) => {
    if (timers.size >= MAX_TIMERS) throw new Error("Surface timer budget exceeded");
    if (typeof callback !== "function") throw new TypeError("Surface timers require a function");
    const boundedDelay = Math.max(4, Math.min(Number(delay) || 0, 60_000));
    let id;
    const run = () => {
      if (!repeat) timers.delete(id);
      try { callback(...args); } catch (error) { fail(error); }
    };
    id = nativeCreate(run, boundedDelay);
    timers.set(id, nativeClear);
    return id;
  };
  globalThis.setTimeout = wrapTimer(nativeSetTimeout, nativeClearTimeout, false);
  globalThis.setInterval = wrapTimer(nativeSetInterval, nativeClearInterval, true);
  globalThis.clearTimeout = (id) => { (timers.get(id) || nativeClearTimeout)(id); timers.delete(id); };
  globalThis.clearInterval = (id) => { (timers.get(id) || nativeClearInterval)(id); timers.delete(id); };
  const clearTimers = () => {
    for (const [id, clear] of timers) clear(id);
    timers.clear();
  };

  globalThis.fetch = () => Promise.reject(new Error("Surface network access is disabled"));
  globalThis.XMLHttpRequest = class { constructor() { throw new Error("Surface network access is disabled"); } };
  globalThis.WebSocket = class { constructor() { throw new Error("Surface network access is disabled"); } };
  globalThis.EventSource = class { constructor() { throw new Error("Surface network access is disabled"); } };
  if (globalThis.navigator?.sendBeacon) {
    try { Object.defineProperty(globalThis.navigator, "sendBeacon", { value: () => false }); } catch (_) {}
  }

  const publicApi = Object.freeze({
    define(definition) {
      if (!definition || typeof definition.mount !== "function") {
        throw new TypeError("NeuroSurface.define requires a mount function");
      }
      if (moduleDefinition) throw new Error("A Surface entry may only define one module");
      moduleDefinition = Object.freeze({ ...definition });
      void start();
    },
    emit(event) {
      if (!port || !token || disposed) return false;
      port.postMessage({ type: "event", token, event });
      return true;
    },
    snapshot() {
      return context ? structuredClone(context.snapshot) : null;
    },
    resource(resourceId) {
      return context?.resources?.[resourceId];
    },
  });
  Object.defineProperty(globalThis, "NeuroSurface", {
    value: publicApi,
    writable: false,
    configurable: false,
    enumerable: true,
  });

  const invoke = async (name, argument) => {
    const handler = moduleDefinition?.[name];
    if (typeof handler !== "function") return undefined;
    return await handler(argument);
  };
  const start = async () => {
    if (started || disposed || !context || !moduleDefinition) return;
    started = true;
    try {
      const cleanup = await invoke("mount", {
        root: document.getElementById("surface-root"),
        snapshot: structuredClone(context.snapshot),
        resources: Object.freeze({ ...context.resources }),
        emit: publicApi.emit,
      });
      if (typeof cleanup === "function") mountCleanup = cleanup;
      port.postMessage({ type: "ready", token });
    } catch (error) {
      started = false;
      fail(error);
    }
  };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    clearTimers();
    if (heartbeatId !== null) nativeClearInterval(heartbeatId);
    heartbeatId = null;
    observer.disconnect();
    longTaskObserver?.disconnect();
    longTaskObserver = null;
    try { if (mountCleanup) await mountCleanup(); } catch (error) { fail(error); }
    try { await invoke("dispose", undefined); } catch (error) { fail(error); }
    document.body.replaceChildren();
    port?.close();
  };

  const observer = new MutationObserver(() => {
    if (document.getElementsByTagName("*").length > MAX_DOM_NODES) {
      fail(new Error("Surface DOM node budget exceeded"));
      void dispose();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (typeof globalThis.PerformanceObserver === "function") {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) cpuWindowMillis += entry.duration;
      });
      longTaskObserver.observe({ entryTypes: ["longtask"] });
      longTaskTelemetryAvailable = true;
    } catch (_) {
      longTaskObserver = null;
    }
  }
  heartbeatId = nativeSetInterval(() => {
    if (!port || !token || disposed) return;
    const now = performance.now();
    const cpuWindowElapsed = now - cpuWindowStartedAt;
    const heapBytes = readHeapBytes();
    const heapGrowthBytes = heapBaselineBytes !== null && heapBytes !== null
      ? Math.max(0, heapBytes - heapBaselineBytes)
      : null;
    const budget = {
      capabilities: {
        heap: heapGrowthBytes !== null,
        longTask: longTaskTelemetryAvailable,
      },
      heapGrowthBytes,
      cpuWindowMillis: longTaskTelemetryAvailable ? cpuWindowMillis : null,
      domNodes: document.getElementsByTagName("*").length,
      timers: timers.size,
    };
    if (budget.heapGrowthBytes !== null && budget.heapGrowthBytes > MAX_HEAP_GROWTH_BYTES) {
      fail(new Error("Surface memory budget exceeded"));
      void dispose();
      return;
    }
    if (budget.cpuWindowMillis !== null && budget.cpuWindowMillis > MAX_CPU_WINDOW_MILLIS) {
      fail(new Error("Surface CPU budget exceeded"));
      void dispose();
      return;
    }
    port.postMessage({ type: "heartbeat", token, budget });
    if (cpuWindowElapsed >= 1_000) {
      cpuWindowStartedAt = now;
      cpuWindowMillis = 0;
    }
  }, 500);

  globalThis.addEventListener("message", (event) => {
    if (port || event.data?.type !== "surface:init" || !event.ports?.[0]) return;
    token = event.data.token;
    context = { snapshot: event.data.snapshot, resources: event.data.resources || {} };
    port = event.ports[0];
    port.onmessage = async (messageEvent) => {
      const message = messageEvent.data;
      if (!message || message.token !== token || disposed) return;
      try {
        if (message.type === "snapshot") {
          context = { snapshot: message.snapshot, resources: message.resources || {} };
          await invoke("update", {
            snapshot: structuredClone(context.snapshot),
            resources: Object.freeze({ ...context.resources }),
          });
        } else if (message.type === "suspend") {
          clearTimers();
          await invoke("suspend", undefined);
        } else if (message.type === "resume") {
          await invoke("resume", undefined);
        } else if (message.type === "dispose") {
          await dispose();
        }
      } catch (error) { fail(error); }
    };
    port.start();
    void start();
  }, { once: true });

  const bytes = Uint8Array.from(atob(ENTRY_BASE64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/javascript" }));
  import(url).catch(fail).finally(() => URL.revokeObjectURL(url));
})();`;
    const csp = [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' blob:`,
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "media-src data: blob:",
        "font-src data:",
        "connect-src 'none'",
        "worker-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-src 'none'",
    ].join("; ");
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${htmlEscape(csp)}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#surface-root{width:100%;height:100%;margin:0;overflow:hidden;color:CanvasText;background:transparent;font:inherit}*{box-sizing:border-box}</style></head><body><div id="surface-root"></div><script nonce="${htmlEscape(nonce)}">${bootstrap}</script></body></html>`;
};

const randomIdentity = (prefix: string): string =>
    `${prefix}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export const JavaScriptSurface: Component<Props> = (props) => {
    let iframe: HTMLIFrameElement | undefined;
    let port: MessagePort | undefined;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let lastHeartbeat = 0;
    let eventBudgetWindow: JavaScriptSurfaceEventBudgetWindow = {
        windowStartedAt: 0,
        count: 0,
    };
    const [ready, setReady] = createSignal(false);
    const [runtimeError, setRuntimeError] = createSignal<string>();
    const token = randomIdentity("surface-token");
    const nonce = randomIdentity("surface-nonce").replaceAll(":", "-");
    const entryResource = createMemo(() => {
        const resourceId = props.snapshot.entryResourceId;
        return parseJavaScriptSurfaceDataUrl(resourceId ? props.resolveResource(resourceId) : undefined);
    });
    const documentSource = createMemo(() => {
        const entry = entryResource();
        return entry ? buildJavaScriptSurfaceDocument(entry.base64, nonce) : undefined;
    });
    const documentUrl = createMemo(() => {
        const source = documentSource();
        if (!source) return undefined;
        const url = URL.createObjectURL(new Blob([source], { type: "text/html" }));
        onCleanup(() => URL.revokeObjectURL(url));
        return url;
    });
    const resolvedResources = () => Object.fromEntries(
        (props.snapshot.resourceLeases ?? [])
            .map((lease) => [lease.resource.resourceId, props.resolveResource(lease.resource.resourceId)] as const)
            .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string"),
    );

    const closeRuntime = (sendDispose: boolean): void => {
        if (sendDispose && port) port.postMessage({ type: "dispose", token });
        port?.close();
        port = undefined;
        if (watchdog) clearInterval(watchdog);
        watchdog = undefined;
        setReady(false);
    };

    const handleRuntimeMessage = (message: RuntimeMessage): void => {
        if (!message || message.token !== token) return;
        if (message.type === "heartbeat") {
            const budgetFailure = javaScriptSurfaceBudgetFailure(message.budget);
            if (budgetFailure) {
                setRuntimeError(budgetFailure);
                closeRuntime(false);
                iframe?.remove();
                return;
            }
            lastHeartbeat = Date.now();
            return;
        }
        if (message.type === "failure") {
            setRuntimeError(typeof message.message === "string" ? message.message : "JavaScript Surface failed");
            closeRuntime(false);
            return;
        }
        if (message.type === "ready") {
            lastHeartbeat = Date.now();
            setReady(true);
            setRuntimeError(undefined);
            return;
        }
        const eventBudget = consumeJavaScriptSurfaceEventBudget(eventBudgetWindow, Date.now());
        eventBudgetWindow = eventBudget.window;
        if (!eventBudget.allowed || !message.event) return;
        const snapshot = props.snapshot;
        if (!validateJavaScriptSurfaceEvent(snapshot, message.event)) return;
        props.onEvent({
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: snapshot.instanceId,
            attachmentId: snapshot.attachmentId,
            eventId: randomIdentity("event"),
            nodeId: message.event.nodeId,
            event: message.event.event,
            action: message.event.action,
            class: message.event.class as SurfaceEventClass,
            generation: props.generation,
            baseRevision: snapshot.revision,
            payload: message.event.payload ?? null,
        });
    };

    const initializeRuntime = (): void => {
        if (!iframe?.contentWindow || !entryResource()) return;
        closeRuntime(false);
        const resources = resolvedResources();
        const resourceBudgetFailure = javaScriptSurfaceResourceBudgetFailure(resources);
        if (resourceBudgetFailure) {
            setRuntimeError(resourceBudgetFailure);
            iframe.remove();
            return;
        }
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = (event: MessageEvent<RuntimeMessage>) => handleRuntimeMessage(event.data);
        port.start();
        lastHeartbeat = Date.now();
        const transferableSnapshot = cloneSurfaceJson(props.snapshot);
        const transferableResources = cloneSurfaceJson(resources);
        iframe.contentWindow.postMessage({
            type: "surface:init",
            token,
            snapshot: transferableSnapshot,
            resources: transferableResources,
        }, "*", [channel.port2]);
        port.postMessage({
            type: props.lifecycle === "suspended" || props.lifecycle === "inactive"
                ? "suspend"
                : "resume",
            token,
        });
        watchdog = setInterval(() => {
            if (Date.now() - lastHeartbeat <= WATCHDOG_MILLIS) return;
            setRuntimeError("JavaScript Surface exceeded its response budget");
            closeRuntime(false);
            iframe?.remove();
        }, 500);
    };

    createEffect(() => {
        const snapshot = props.snapshot;
        const resources = resolvedResources();
        if (!port) return;
        const resourceBudgetFailure = javaScriptSurfaceResourceBudgetFailure(resources);
        if (resourceBudgetFailure) {
            setRuntimeError(resourceBudgetFailure);
            closeRuntime(false);
            iframe?.remove();
            return;
        }
        port.postMessage({
            type: "snapshot",
            token,
            snapshot: cloneSurfaceJson(snapshot),
            resources: cloneSurfaceJson(resources),
        });
    });

    createEffect(() => {
        if (!port) return;
        port.postMessage({
            type: props.lifecycle === "suspended" || props.lifecycle === "inactive"
                ? "suspend"
                : "resume",
            token,
        });
    });

    onCleanup(() => closeRuntime(true));

    return (
        <div class="javascript-surface-host" data-runtime-error={runtimeError()}>
            <Show when={documentUrl()}>
                {(source) => (
                    <iframe
                        ref={iframe}
                        class="javascript-surface-frame"
                        classList={{ "is-ready": ready() }}
                        sandbox="allow-scripts"
                        src={source()}
                        tabindex={props.interactive === false ? -1 : 0}
                        aria-label="Art Surface"
                        onLoad={initializeRuntime}
                        style={{ "pointer-events": props.interactive === false ? "none" : "auto" }}
                    />
                )}
            </Show>
            <Show when={!ready()}>
                <div class="javascript-surface-fallback">
                    <DeclarativeSurface
                        unitId={props.unitId}
                        snapshot={props.snapshot}
                        generation={props.generation}
                        interactive={props.interactive}
                        resolveResource={props.resolveResource}
                        onEvent={props.onEvent}
                    />
                </div>
            </Show>
        </div>
    );
};
