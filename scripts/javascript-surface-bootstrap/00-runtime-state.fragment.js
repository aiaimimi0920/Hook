/* global Blob, MutationObserver, PerformanceObserver, URL, atob, document, performance, structuredClone */

(() => {
  "use strict";

  const MAX_TIMERS = 64;
  const MAX_DOM_NODES = 1000;
  const MAX_HEAP_GROWTH_BYTES = 64 * 1024 * 1024;
  const MAX_CPU_WINDOW_MILLIS = 250;
  const MAX_ENTRY_BYTES = 512 * 1024;
  const MAX_ENTRY_BASE64_CHARS = Math.ceil(MAX_ENTRY_BYTES / 3) * 4;
  const SAFE_TOKEN = /^[A-Za-z0-9._:/-]{1,160}$/;
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
  let runtimeMessageTail = Promise.resolve();
