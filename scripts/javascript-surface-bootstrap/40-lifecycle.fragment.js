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
      if (!postToHost({ type: "ready", token })) {
        throw new Error("JavaScript Surface host connection closed before ready");
      }
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
    try { port?.close(); } catch { /* Best-effort teardown. */ }
    port = null;
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
    postToHost({ type: "heartbeat", token, budget });
    if (cpuWindowElapsed >= 1_000) {
      cpuWindowStartedAt = now;
      cpuWindowMillis = 0;
    }
  }, 500);
