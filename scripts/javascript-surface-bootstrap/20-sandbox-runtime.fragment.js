  const readHeapBytes = () => {
    const value = globalThis.performance?.memory?.usedJSHeapSize;
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const heapBaselineBytes = readHeapBytes();

  const postToHost = (message) => {
    if (!port || !token) return false;
    try {
      port.postMessage(message);
      return true;
    } catch {
      return false;
    }
  };
  const fail = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    postToHost({ type: "failure", token, message });
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
      return postToHost({ type: "event", token, event });
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
