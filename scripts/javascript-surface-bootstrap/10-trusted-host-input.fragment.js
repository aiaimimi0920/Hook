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
      "input, textarea, select, button, a[href], [contenteditable='true'], [role='button'], [role='slider'], [data-surface-no-drag], [data-surface-selectable-text='true']",
    ) !== null;
  const resolveInteractiveTarget = (target) => {
    if (!(target instanceof Element)) return null;
    const interactive = target.closest(
      "input, textarea, select, button, a[href], [contenteditable='true'], [role='button'], [role='slider'], [data-surface-no-drag], [data-surface-selectable-text='true']",
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
