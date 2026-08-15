/* global Blob, MutationObserver, PerformanceObserver, URL, atob, document, performance, structuredClone */

(() => {
  "use strict";

  const MAX_TIMERS = 64;
  const MAX_DOM_NODES = 1000;
  const MAX_HEAP_GROWTH_BYTES = 64 * 1024 * 1024;
  const MAX_CPU_WINDOW_MILLIS = 500;
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
    try { Object.defineProperty(globalThis.navigator, "sendBeacon", { value: () => false }); } catch { /* Best-effort hardening. */ }
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
      cpuWindowStartedAt = performance.now();
      cpuWindowMillis = 0;
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
        for (const entry of list.getEntries()) {
          if (entry.startTime >= cpuWindowStartedAt) cpuWindowMillis += entry.duration;
        }
      });
      longTaskObserver.observe({ entryTypes: ["longtask"] });
      longTaskTelemetryAvailable = true;
    } catch {
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

  const loadEntry = async (entryBase64) => {
    if (typeof entryBase64 !== "string" || entryBase64.length === 0) {
      throw new Error("JavaScript Surface entry is missing");
    }
    const bytes = Uint8Array.from(atob(entryBase64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/javascript" }));
    try {
      await import(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  globalThis.addEventListener("message", async (event) => {
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
    try {
      await loadEntry(event.data.entryBase64);
      await start();
    } catch (error) {
      fail(error);
    }
  }, { once: true });
})();
