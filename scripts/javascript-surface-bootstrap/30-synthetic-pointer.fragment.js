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
