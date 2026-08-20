/* global Blob, MutationObserver, PerformanceObserver, URL, atob, document, performance, structuredClone */

(() => {
  "use strict";

  const MAX_TIMERS = 64;
  const MAX_DOM_NODES = 1000;
  const MAX_HEAP_GROWTH_BYTES = 64 * 1024 * 1024;
  const MAX_CPU_WINDOW_MILLIS = 250;
  const SYNTHETIC_INTERACTIVE_CLICK_MAX_DISTANCE = 8;
  const SYNTHETIC_BACKGROUND_CLICK_MAX_DISTANCE = 4;
  const SYNTHETIC_BACKGROUND_DOUBLE_CLICK_MAX_DELAY_MILLIS = 320;
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
  let syntheticPointerDownTarget = null;
  let syntheticPointerDownInteractiveTarget = null;
  let syntheticPointerDownPoint = null;
  let hostGestureSequence = 0;
  let activeHostGesture = null;
  let lastSyntheticBackgroundClick = null;
  let pendingEditableFocusTarget = null;

  const nextHostGestureId = () => {
    hostGestureSequence = hostGestureSequence >= Number.MAX_SAFE_INTEGER
      ? 1
      : hostGestureSequence + 1;
    return hostGestureSequence;
  };
  const normalizedPointer = (x, y) => ({
    normalizedX: innerWidth > 0 ? x / innerWidth : 0,
    normalizedY: innerHeight > 0 ? y / innerHeight : 0,
  });

  const isInteractiveTarget = (target) => target instanceof Element
    && target.closest(
      "input, textarea, select, button, a[href], [contenteditable='true'], [role='button'], [role='slider'], [data-surface-no-drag]",
    ) !== null;
  const resolveInteractiveTarget = (target) => {
    if (!(target instanceof Element)) return null;
    const interactive = target.closest(
      "input, textarea, select, button, a[href], [contenteditable='true'], [role='button'], [role='slider'], [data-surface-no-drag]",
    );
    return interactive instanceof HTMLElement ? interactive : null;
  };
  const blurActiveEditable = () => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (
      active.isContentEditable
      || active.tagName === "INPUT"
      || active.tagName === "TEXTAREA"
      || active.tagName === "SELECT"
    ) {
      active.blur();
    }
  };
  const canNotifyHost = (event) => Boolean(port && token && !disposed && event.isTrusted);
  const hostDragPointer = (event, gestureId) => ({
    gestureId,
    x: event.clientX,
    y: event.clientY,
    ...normalizedPointer(event.clientX, event.clientY),
    pointerId: Number.isInteger(event.pointerId) ? event.pointerId : 1,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey === true,
    altKey: event.altKey === true,
    shiftKey: event.shiftKey === true,
    metaKey: event.metaKey === true,
  });
  const notifyHostPointerDown = (event) => {
    if (!canNotifyHost(event)) return;
    if (activeHostGesture) return;
    const gestureId = nextHostGestureId();
    const owner = event.button === 0 && !isInteractiveTarget(event.target)
      ? "host-drag"
      : "surface-control";
    activeHostGesture = {
      gestureId,
      owner,
      pointerId: event.pointerId,
      source: "trusted",
    };
    pendingEditableFocusTarget = event.target instanceof Element
      ? event.target.closest("input, textarea, select, [contenteditable='true']")
      : null;
    port.postMessage({ type: "host-activate", token });
    if (owner !== "host-drag") return;
    event.preventDefault();
    try { event.target?.setPointerCapture?.(event.pointerId); } catch { /* Capture is best-effort. */ }
    port.postMessage({
      type: "host-drag-start",
      token,
      pointer: hostDragPointer(event, gestureId),
    });
  };
  const notifyHostPointerMove = (event) => {
    const gesture = activeHostGesture;
    if (
      !canNotifyHost(event)
      || !gesture
      || gesture.source !== "trusted"
      || gesture.owner !== "host-drag"
      || event.pointerId !== gesture.pointerId
    ) return;
    event.preventDefault();
    port.postMessage({
      type: "host-drag-move",
      token,
      pointer: hostDragPointer(event, gesture.gestureId),
    });
  };
  const notifyHostPointerEnd = (event) => {
    const gesture = activeHostGesture;
    if (
      !canNotifyHost(event)
      || !gesture
      || gesture.source !== "trusted"
      || event.pointerId !== gesture.pointerId
    ) return;
    if (gesture.owner === "host-drag") {
      event.preventDefault();
      port.postMessage({
        type: "host-drag-end",
        token,
        pointer: hostDragPointer(event, gesture.gestureId),
      });
      try { event.target?.releasePointerCapture?.(event.pointerId); } catch { /* Capture may already be gone. */ }
    }
    activeHostGesture = null;
  };
  const notifyHostDoubleClick = (event) => {
    if (!canNotifyHost(event) || event.button !== 0 || isInteractiveTarget(event.target)) return;
    port.postMessage({
      type: "host-background-double-click",
      token,
      pointer: hostDragPointer(event, nextHostGestureId()),
    });
  };
  const notifyHostWheel = (event) => {
    if (!canNotifyHost(event) || (!event.ctrlKey && !event.altKey)) return;
    event.preventDefault();
    port.postMessage({
      type: "host-wheel",
      token,
      wheel: {
        gestureId: nextHostGestureId(),
        x: event.clientX,
        y: event.clientY,
        ...normalizedPointer(event.clientX, event.clientY),
        deltaY: event.deltaY,
        ctrlKey: event.ctrlKey === true,
        altKey: event.altKey === true,
        shiftKey: event.shiftKey === true,
        metaKey: event.metaKey === true,
      },
    });
  };
  const postHostKeydown = (keydown) => {
    if (!port || !token || disposed) return;
    port.postMessage({ type: "host-keydown", token, keydown });
  };
  const notifyHostKeydown = (event) => {
    if (!canNotifyHost(event)) return;
    const isHostReservedShortcut = event.code === "KeyE"
      && event.ctrlKey
      && !event.altKey
      && !event.shiftKey
      && !event.metaKey;
    const keydown = {
      key: String(event.key || "").slice(0, 64),
      code: String(event.code || "").slice(0, 64),
      repeat: event.repeat === true,
      ctrlKey: event.ctrlKey === true,
      altKey: event.altKey === true,
      shiftKey: event.shiftKey === true,
      metaKey: event.metaKey === true,
    };
    if (!isHostReservedShortcut && isInteractiveTarget(event.target)) {
      if (event.key !== "Escape") return;
      // The capture listener runs before the Surface control. Defer Escape so
      // controls can explicitly consume it with preventDefault/stopPropagation;
      // an otherwise unused Escape retains Hook's selected-node behavior.
      nativeSetTimeout(() => {
        if (event.defaultPrevented || event.cancelBubble) return;
        postHostKeydown(keydown);
      }, 0);
      return;
    }
    postHostKeydown(keydown);
    if (
      event.key === "Tab"
      || event.code === "Digit1" && event.shiftKey
      || isHostReservedShortcut
    ) {
      event.preventDefault();
    }
  };
  document.addEventListener("pointerdown", notifyHostPointerDown, true);
  document.addEventListener("pointermove", notifyHostPointerMove, true);
  document.addEventListener("pointerup", notifyHostPointerEnd, true);
  document.addEventListener("pointercancel", notifyHostPointerEnd, true);
  document.addEventListener("dblclick", notifyHostDoubleClick, true);
  document.addEventListener("wheel", notifyHostWheel, { capture: true, passive: false });
  document.addEventListener("keydown", notifyHostKeydown, true);
  globalThis.addEventListener("blur", blurActiveEditable);

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
  const dispatchSyntheticPointer = (value) => {
    const allowedTypes = new Set(["mousedown", "mousemove", "mouseup", "wheel", "contextmenu"]);
    if (!value || !allowedTypes.has(value.type)) return;
    const x = Number(value.x);
    const y = Number(value.y);
    const isDown = value.type === "mousedown";
    const isUp = value.type === "mouseup";
    const isSyntheticContinuation = (value.type === "mousemove" || isUp)
      && activeHostGesture?.source === "synthetic"
      && syntheticPointerDownTarget instanceof Element;
    if (
      !Number.isFinite(x)
      || !Number.isFinite(y)
      || (!isSyntheticContinuation && (x < 0 || y < 0 || x > innerWidth || y > innerHeight))
    ) {
      return;
    }
    const target = isSyntheticContinuation
      ? syntheticPointerDownTarget
      : document.elementFromPoint(x, y);
    if (!(target instanceof Element)) return;
    const suppliedGestureId = Number(value.gestureId);
    const gestureId = Number.isSafeInteger(suppliedGestureId) && suppliedGestureId > 0
      ? suppliedGestureId
      : isDown
        ? nextHostGestureId()
        : null;
    const staleSyntheticGesture = isDown
      && activeHostGesture?.source === "synthetic"
      && gestureId !== activeHostGesture.gestureId
      ? activeHostGesture
      : null;
    if (isDown && activeHostGesture && !staleSyntheticGesture) {
      // A trusted WebView pointer and a native-shield relay can describe the
      // same physical press. Whichever reaches the sandbox first owns it.
      return;
    }
    const button = value.type === "contextmenu" ? 2 : 0;
    const buttons = isDown || value.type === "mousemove" && syntheticPointerDownTarget ? 1 : 0;
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button,
      buttons,
      ctrlKey: value.ctrlKey === true,
      altKey: value.altKey === true,
      shiftKey: value.shiftKey === true,
      metaKey: value.metaKey === true,
    };
    const syntheticHostPointer = (buttons, activeGestureId) => ({
      gestureId: activeGestureId,
      x,
      y,
      ...normalizedPointer(x, y),
      pointerId: 1,
      button: 0,
      buttons,
      ctrlKey: value.ctrlKey === true,
      altKey: value.altKey === true,
      shiftKey: value.shiftKey === true,
      metaKey: value.metaKey === true,
    });
    if (staleSyntheticGesture) {
      if (staleSyntheticGesture.owner === "host-drag" && port && token && !disposed) {
        port.postMessage({
          type: "host-drag-end",
          token,
          pointer: syntheticHostPointer(0, staleSyntheticGesture.gestureId),
        });
      }
      activeHostGesture = null;
      syntheticPointerDownTarget = null;
      syntheticPointerDownInteractiveTarget = null;
      syntheticPointerDownPoint = null;
    }
    const mismatchedSyntheticGesture = !isDown
      && (value.type === "mousemove" || isUp)
      && activeHostGesture?.source === "synthetic"
      && gestureId !== null
      && gestureId !== activeHostGesture.gestureId;
    if (mismatchedSyntheticGesture) {
      if (isUp) {
        if (activeHostGesture.owner === "host-drag" && port && token && !disposed) {
          port.postMessage({
            type: "host-drag-end",
            token,
            pointer: syntheticHostPointer(0, activeHostGesture.gestureId),
          });
        }
        activeHostGesture = null;
        syntheticPointerDownTarget = null;
        syntheticPointerDownInteractiveTarget = null;
        syntheticPointerDownPoint = null;
      }
      return;
    }
    if (isDown) {
      syntheticPointerDownTarget = target;
      syntheticPointerDownInteractiveTarget = resolveInteractiveTarget(target);
      syntheticPointerDownPoint = { x, y };
      activeHostGesture = {
        gestureId,
        owner: syntheticPointerDownInteractiveTarget ? "surface-control" : "host-drag",
        pointerId: 1,
        source: "synthetic",
      };
      const editable = target.closest("input, textarea, button, [tabindex]");
      if (editable instanceof HTMLElement) {
        editable.focus();
        pendingEditableFocusTarget = editable.matches("input, textarea, select, [contenteditable='true']")
          ? editable
          : null;
      } else {
        pendingEditableFocusTarget = null;
        blurActiveEditable();
      }
      if (port && token && !disposed) {
        port.postMessage({ type: "host-activate", token });
        if (activeHostGesture.owner === "host-drag") {
          port.postMessage({
            type: "host-drag-start",
            token,
            pointer: syntheticHostPointer(1, activeHostGesture.gestureId),
          });
        }
      }
    }
    const dispatchTarget = syntheticPointerDownTarget && (value.type === "mousemove" || isUp)
      ? syntheticPointerDownTarget
      : target;
    if (value.type === "wheel") {
      if ((value.ctrlKey === true || value.altKey === true) && port && token && !disposed) {
        port.postMessage({
          type: "host-wheel",
          token,
          wheel: {
            ...syntheticHostPointer(0, nextHostGestureId()),
            deltaY: Math.max(-1000, Math.min(1000, Number(value.deltaY) || 0)),
          },
        });
      }
      dispatchTarget.dispatchEvent(new WheelEvent("wheel", { ...base, deltaY: Math.max(-1000, Math.min(1000, Number(value.deltaY) || 0)) }));
      return;
    }
    if (value.type === "contextmenu") {
      dispatchTarget.dispatchEvent(new MouseEvent("contextmenu", base));
      return;
    }
    const syntheticGesture = activeHostGesture?.source === "synthetic"
      ? activeHostGesture
      : null;
    if (syntheticGesture?.owner === "host-drag" && value.type === "mousemove" && port && token && !disposed) {
      port.postMessage({
        type: "host-drag-move",
        token,
        pointer: syntheticHostPointer(1, syntheticGesture.gestureId),
      });
    }
    if (typeof PointerEvent === "function") {
      dispatchTarget.dispatchEvent(new PointerEvent(
        isUp ? "pointerup" : value.type === "mousemove" ? "pointermove" : "pointerdown",
        { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true },
      ));
    }
    dispatchTarget.dispatchEvent(new MouseEvent(value.type, base));
    if (isUp) {
      if (syntheticGesture?.owner === "host-drag" && port && token && !disposed) {
        port.postMessage({
          type: "host-drag-end",
          token,
          pointer: syntheticHostPointer(0, syntheticGesture.gestureId),
        });
      }
      const releasedInteractiveTarget = resolveInteractiveTarget(dispatchTarget);
      const interactiveClick = syntheticPointerDownInteractiveTarget
        && releasedInteractiveTarget === syntheticPointerDownInteractiveTarget
        && syntheticPointerDownPoint
        && Math.hypot(x - syntheticPointerDownPoint.x, y - syntheticPointerDownPoint.y)
          <= SYNTHETIC_INTERACTIVE_CLICK_MAX_DISTANCE;
      if (
        syntheticPointerDownTarget === dispatchTarget
        && syntheticPointerDownPoint
        && (interactiveClick || Math.hypot(x - syntheticPointerDownPoint.x, y - syntheticPointerDownPoint.y) <= 4)
      ) {
        const clickInit = { ...base, buttons: 0 };
        if (interactiveClick && typeof syntheticPointerDownInteractiveTarget.click === "function") {
          syntheticPointerDownInteractiveTarget.click();
        } else {
          dispatchTarget.dispatchEvent(new MouseEvent("click", clickInit));
        }
      }
      if (
        syntheticGesture?.owner === "host-drag"
        && syntheticPointerDownTarget === dispatchTarget
        && syntheticPointerDownPoint
        && Math.hypot(x - syntheticPointerDownPoint.x, y - syntheticPointerDownPoint.y)
          <= SYNTHETIC_BACKGROUND_CLICK_MAX_DISTANCE
      ) {
        const clickAt = performance.now();
        const isDoubleClick = lastSyntheticBackgroundClick
          && lastSyntheticBackgroundClick.target === dispatchTarget
          && clickAt - lastSyntheticBackgroundClick.at
            <= SYNTHETIC_BACKGROUND_DOUBLE_CLICK_MAX_DELAY_MILLIS
          && Math.hypot(
            x - lastSyntheticBackgroundClick.x,
            y - lastSyntheticBackgroundClick.y,
          ) <= SYNTHETIC_BACKGROUND_CLICK_MAX_DISTANCE;
        if (isDoubleClick && port && token && !disposed) {
          port.postMessage({
            type: "host-background-double-click",
            token,
            pointer: syntheticHostPointer(0, syntheticGesture.gestureId),
          });
          lastSyntheticBackgroundClick = null;
        } else {
          lastSyntheticBackgroundClick = { target: dispatchTarget, x, y, at: clickAt };
        }
      }
      activeHostGesture = null;
      syntheticPointerDownTarget = null;
      syntheticPointerDownInteractiveTarget = null;
      syntheticPointerDownPoint = null;
    }
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
    document.removeEventListener("pointerdown", notifyHostPointerDown, true);
    document.removeEventListener("pointermove", notifyHostPointerMove, true);
    document.removeEventListener("pointerup", notifyHostPointerEnd, true);
    document.removeEventListener("pointercancel", notifyHostPointerEnd, true);
    document.removeEventListener("dblclick", notifyHostDoubleClick, true);
    document.removeEventListener("wheel", notifyHostWheel, true);
    document.removeEventListener("keydown", notifyHostKeydown, true);
    activeHostGesture = null;
    lastSyntheticBackgroundClick = null;
    syntheticPointerDownTarget = null;
    syntheticPointerDownInteractiveTarget = null;
    syntheticPointerDownPoint = null;
    globalThis.removeEventListener("blur", blurActiveEditable);
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
        } else if (message.type === "pointer") {
          dispatchSyntheticPointer(message.pointer);
        } else if (message.type === "release-editable-focus") {
          pendingEditableFocusTarget = null;
          blurActiveEditable();
        } else if (message.type === "restore-editable-focus") {
          if (pendingEditableFocusTarget?.isConnected) pendingEditableFocusTarget.focus();
          pendingEditableFocusTarget = null;
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
