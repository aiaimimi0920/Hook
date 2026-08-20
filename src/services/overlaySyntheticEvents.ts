// Overlay synthetic mouse-event engine.
//
// The native overlay layer (Rust global mouse/keyboard hooks) forwards raw
// pointer samples to the webview. This module turns that raw stream into a
// faithful sequence of DOM pointer/mouse events (enter/leave/over/out,
// pointer-capture semantics, click/double-click synthesis) so that ordinary
// DOM event handlers in the SolidJS tree behave as if a real mouse were used.
//
// It was extracted verbatim from app.tsx to make the many special-case
// branches (shift-bypass for sticker drag-out, live link-target resolution,
// sticker-drag target pinning, click distance/double-click thresholds)
// independently testable. All external, non-deterministic, or environment
// dependencies (document, window, Date.now, and the two reactive reads
// linkingState/draggingStickerId) are injected so the engine can run under a
// controlled DOM in tests while preserving production behavior 1:1.

export type OverlaySyntheticMousePayload = {
    x?: number;
    y?: number;
    globalX?: number;
    globalY?: number;
    ctrlKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
    metaKey?: boolean;
    deltaY?: number;
    nativeDragPreflight?: boolean;
};

export type OverlaySyntheticEventType =
    | "mousedown"
    | "mousemove"
    | "mouseup"
    | "wheel"
    | "contextmenu";

export const OVERLAY_GLOBAL_MOUSE_UP_EVENT = "hook:overlay-global-mouse-up";
export const JAVASCRIPT_SURFACE_POINTER_EVENT = "hook:javascript-surface-pointer";

export interface JavaScriptSurfacePointerDetail extends OverlaySyntheticMousePayload {
    type: OverlaySyntheticEventType;
    gestureId?: number;
}

export interface OverlaySyntheticDeps {
    /** Document the synthetic events are dispatched against. */
    doc: Document;
    /**
     * Hit-tests a client-space point to an element. Defaults to
     * `doc.elementFromPoint`. Injected so tests (and jsdom, which has no
     * layout) can supply deterministic hit results.
     */
    elementFromPoint?: (x: number, y: number) => EventTarget | null;
    /** Live read of whether the canvas is currently in link-drawing mode. */
    isLinking: () => boolean;
    /** Live read of the sticker id currently being dragged, if any. */
    getDraggingStickerId: () => string | null;
    /** Clock, injected so double-click timing is deterministic in tests. */
    now?: () => number;
    /** Window used for overlay-root comparisons / fallback target. */
    win?: Window;
}

const OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE = 4;
// Native shield coordinates can move a few pixels between the down/up
// samples, especially when an Art Surface is transformed. Keep ordinary
// canvas clicks strict so a drag cannot become a click, but give an actual
// interactive control a small dedicated tolerance.
const OVERLAY_SYNTHETIC_INTERACTIVE_CLICK_MAX_DISTANCE = 8;
const OVERLAY_SYNTHETIC_DOUBLE_CLICK_MAX_DELAY_MS = 320;

export interface OverlaySyntheticDispatcher {
    dispatch: (type: OverlaySyntheticEventType, payload: OverlaySyntheticMousePayload) => void;
    relayPointerMove: (event: MouseEvent) => void;
    reset: () => void;
    readonly moveRelayActive: boolean;
}

export function shouldResetOverlaySyntheticOnGlobalMouseUp(
    tauriRuntime: boolean,
    isTrusted: boolean,
): boolean {
    // In Tauri, an untrusted mouseup was dispatched by this engine. Resetting
    // from the bubbling App handler would erase the down target before the
    // dispatcher can synthesize the matching click.
    return !tauriRuntime || isTrusted;
}

export function createOverlaySyntheticDispatcher(
    deps: OverlaySyntheticDeps,
): OverlaySyntheticDispatcher {
    const doc = deps.doc;
    const win = deps.win ?? doc.defaultView ?? (globalThis as unknown as Window);
    const now = deps.now ?? (() => Date.now());
    const elementFromPoint =
        deps.elementFromPoint ?? ((x: number, y: number) => doc.elementFromPoint(x, y));

    let overlaySyntheticPointerTarget: EventTarget | null = null;
    let overlaySyntheticPointerDownTarget: EventTarget | null = null;
    let overlaySyntheticPointerDownInteractiveTarget: Element | null = null;
    let overlaySyntheticHoverTarget: EventTarget | null = null;
    let overlaySyntheticPointerDownPoint: { x: number; y: number } | null = null;
    let overlaySyntheticLastClickTarget: EventTarget | null = null;
    let overlaySyntheticLastClickPoint: { x: number; y: number } | null = null;
    let overlaySyntheticLastClickAt = 0;
    let overlaySyntheticPointerActive = false;
    let overlaySyntheticPrimaryButtonDown = false;
    let overlaySyntheticMoveRelayActive = false;
    let overlaySyntheticGestureSequence = 0;
    let overlaySyntheticActiveGestureId: number | null = null;

    const nextOverlaySyntheticGestureId = () => {
        overlaySyntheticGestureSequence = overlaySyntheticGestureSequence >= Number.MAX_SAFE_INTEGER
            ? 1
            : overlaySyntheticGestureSequence + 1;
        return overlaySyntheticGestureSequence;
    };

    const resolveJavaScriptSurfaceFrame = (
        target: EventTarget,
    ): HTMLIFrameElement | null => {
        if (
            target instanceof HTMLIFrameElement &&
            target.dataset.javascriptSurfaceFrame === "true"
        ) {
            return target;
        }
        if (!(target instanceof Element)) return null;
        const host = target.closest(".javascript-surface-host");
        const frameSelector = "iframe[data-javascript-surface-frame='true']";
        return host?.querySelector<HTMLIFrameElement>(frameSelector)
            ?? target.querySelector<HTMLIFrameElement>(frameSelector)
            ?? target.closest(".art-surface-presentation")?.querySelector<HTMLIFrameElement>(frameSelector)
            ?? null;
    };

    const resolveSurfaceTargetBehindStickerInteraction = (
        stickerInteractionRoot: Element,
        clientX: number,
        clientY: number,
    ): Element | null => {
        // The annotation layer is intentionally above the visual layer while
        // an Art node is being edited. Its empty root therefore wins the
        // parent document hit-test even when the pointer is over a live
        // Surface iframe. Keep real annotation descendants on the annotation
        // path, but let blank SVG/root hits fall through to the Surface.
        if (
            stickerInteractionRoot.getAttribute("data-sticker-surface-pass-through") !== "true"
        ) {
            return null;
        }
        const visual = stickerInteractionRoot.closest(".sticker-visual");
        const frame = visual?.querySelector<HTMLIFrameElement>(
            ".art-surface-presentation iframe[data-javascript-surface-frame='true']",
        );
        const containsPoint = (element: Element) => {
            if (element instanceof HTMLElement) {
                const computedPointerEvents = typeof win.getComputedStyle === "function"
                    ? win.getComputedStyle(element).pointerEvents
                    : "";
                if (element.style.pointerEvents === "none" || computedPointerEvents === "none") {
                    return false;
                }
            }
            const rect = element.getBoundingClientRect();
            return (
                rect.width > 0
                && rect.height > 0
                && clientX >= rect.left
                && clientX <= rect.right
                && clientY >= rect.top
                && clientY <= rect.bottom
            );
        };
        if (frame && containsPoint(frame)) return frame;

        const presentation = visual?.querySelector<HTMLElement>(".art-surface-presentation");
        if (!presentation || !containsPoint(presentation)) return null;

        // Declarative surfaces live in the same presentation wrapper as the
        // JavaScript fallback. Resolve the deepest control under the native
        // point so its own click/input handler receives the synthetic event.
        const controls = presentation.querySelectorAll<HTMLElement>(
            "input, select, textarea, button, a[href], [contenteditable='true'], [role='button'], [role='slider'], [data-surface-no-drag], [data-surface-node-id]",
        );
        for (let index = controls.length - 1; index >= 0; index -= 1) {
            if (containsPoint(controls[index])) return controls[index];
        }

        // A blank declarative Surface should still bubble to the UnitView
        // container so the normal Art-node drag path remains available.
        return presentation;
    };

    const relayJavaScriptSurfacePointer = (
        target: EventTarget,
        type: OverlaySyntheticEventType,
        payload: OverlaySyntheticMousePayload,
    ): boolean => {
        const frame = resolveJavaScriptSurfaceFrame(target);
        if (!frame) return false;
        // A compact Art node must use the same parent-DOM double-click path as
        // an ordinary sticker. Relaying into its hidden/non-interactive iframe
        // lets Surface controls consume the gesture before UnitView can restore.
        if (frame.dataset.javascriptSurfaceInteractive === "false") return false;
        // Focus the browsing context only at pointer-down. Re-focusing the
        // iframe on move/up would replace the input/button focus established
        // by the sandbox-side hit test before the user can type or click.
        if (type === "mousedown") frame.focus();
        frame.dispatchEvent(new CustomEvent<JavaScriptSurfacePointerDetail>(
            JAVASCRIPT_SURFACE_POINTER_EVENT,
            {
                detail: {
                    ...payload,
                    type,
                    gestureId: overlaySyntheticActiveGestureId ?? undefined,
                },
            },
        ));
        return true;
    };

    const resetOverlaySyntheticPointerState = () => {
        overlaySyntheticPointerTarget = null;
        overlaySyntheticPointerDownTarget = null;
        overlaySyntheticPointerDownInteractiveTarget = null;
        overlaySyntheticPointerDownPoint = null;
        overlaySyntheticPointerActive = false;
        overlaySyntheticPrimaryButtonDown = false;
        overlaySyntheticMoveRelayActive = false;
        overlaySyntheticActiveGestureId = null;
    };

    const dispatchSyntheticOverlayMouseEvent = (
        type: OverlaySyntheticEventType,
        payload: OverlaySyntheticMousePayload,
    ) => {
        if (typeof doc === "undefined" || !doc) return;

        const clientX = payload.x ?? payload.globalX ?? 0;
        const clientY = payload.y ?? payload.globalY ?? 0;
        const appMain = doc.getElementById("app-main");
        const resolveEditableSyntheticControl = (target: EventTarget | null) => {
            if (!(target instanceof Element)) return null;
            if (
                target instanceof HTMLInputElement ||
                target instanceof HTMLSelectElement ||
                target instanceof HTMLTextAreaElement
            ) {
                return target;
            }
            return target.closest("input, select, textarea");
        };
        const focusEditableSyntheticControl = (target: EventTarget | null) => {
            const editable = resolveEditableSyntheticControl(target);
            if (!editable || !(editable instanceof HTMLElement)) return;
            editable.focus();
        };
        const resolveInteractiveSyntheticTarget = (target: EventTarget | null): Element | null => {
            if (!(target instanceof Element)) return null;
            if (target.matches(
                "input, select, textarea, button, a[href], [contenteditable='true'], [role='button'], [role='slider'], [data-surface-no-drag]",
            )) {
                return target;
            }
            return target.closest(
                "input, select, textarea, button, a[href], [contenteditable='true'], [role='button'], [role='slider'], [data-surface-no-drag]",
            );
        };
        const isOverlayRootTarget = (target: EventTarget | null) =>
            target === appMain ||
            target === doc.body ||
            target === doc.documentElement ||
            target === win;
        const isStickerInteractionRootTarget = (target: EventTarget | null) =>
            target instanceof Element &&
            target.getAttribute("data-sticker-interaction-root") === "true";
        const resolveTarget = (allowFallback: boolean) => {
            const rawTarget = elementFromPoint(clientX, clientY) as EventTarget | null;
            if (!rawTarget || isOverlayRootTarget(rawTarget)) {
                return allowFallback ? appMain ?? win : null;
            }
            if (rawTarget instanceof Element) {
                if (rawTarget.closest?.("[data-overlay-synthetic-target='direct']")) {
                    return rawTarget;
                }
                const stickerInteractionRoot =
                    rawTarget.closest?.("[data-sticker-interaction-root='true']") ?? null;
                if (stickerInteractionRoot) {
                    const isBlankStickerInteractionHit =
                        rawTarget === stickerInteractionRoot
                        || (
                            typeof SVGElement !== "undefined"
                            && rawTarget instanceof SVGElement
                            && rawTarget.tagName.toLowerCase() === "svg"
                        );
                    if (isBlankStickerInteractionHit) {
                        const surfaceTarget = resolveSurfaceTargetBehindStickerInteraction(
                            stickerInteractionRoot,
                            clientX,
                            clientY,
                        );
                        if (surfaceTarget) return surfaceTarget;
                    }
                    return stickerInteractionRoot;
                }
            }
            return rawTarget;
        };
        const buildBaseInit = (button: number, buttons: number) => ({
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX,
            clientY,
            screenX: payload.globalX ?? clientX,
            screenY: payload.globalY ?? clientY,
            ctrlKey: !!payload.ctrlKey,
            altKey: !!payload.altKey,
            shiftKey: !!payload.shiftKey,
            metaKey: !!payload.metaKey,
            button,
            buttons,
        });
        const dispatchHoverTransition = (
            nextTarget: EventTarget | null,
            pointerInit: PointerEventInit,
            mouseInit: MouseEventInit,
        ) => {
            const previousTarget = overlaySyntheticHoverTarget;
            if (previousTarget === nextTarget) {
                return;
            }

            if (previousTarget) {
                if (typeof PointerEvent !== "undefined") {
                    previousTarget.dispatchEvent(
                        new PointerEvent("pointerout", {
                            ...pointerInit,
                            relatedTarget: nextTarget,
                        }),
                    );
                    previousTarget.dispatchEvent(
                        new PointerEvent("pointerleave", {
                            ...pointerInit,
                            bubbles: false,
                            relatedTarget: nextTarget,
                        }),
                    );
                }
                previousTarget.dispatchEvent(
                    new MouseEvent("mouseout", {
                        ...mouseInit,
                        relatedTarget: nextTarget,
                    }),
                );
                previousTarget.dispatchEvent(
                    new MouseEvent("mouseleave", {
                        ...mouseInit,
                        bubbles: false,
                        relatedTarget: nextTarget,
                    }),
                );
            }

            if (nextTarget) {
                if (typeof PointerEvent !== "undefined") {
                    nextTarget.dispatchEvent(
                        new PointerEvent("pointerover", {
                            ...pointerInit,
                            relatedTarget: previousTarget,
                        }),
                    );
                    nextTarget.dispatchEvent(
                        new PointerEvent("pointerenter", {
                            ...pointerInit,
                            bubbles: false,
                            relatedTarget: previousTarget,
                        }),
                    );
                }
                nextTarget.dispatchEvent(
                    new MouseEvent("mouseover", {
                        ...mouseInit,
                        relatedTarget: previousTarget,
                    }),
                );
                nextTarget.dispatchEvent(
                    new MouseEvent("mouseenter", {
                        ...mouseInit,
                        bubbles: false,
                        relatedTarget: previousTarget,
                    }),
                );
            }

            overlaySyntheticHoverTarget = nextTarget;
        };

        const baseInit =
            type === "contextmenu"
                ? buildBaseInit(2, 0)
                : buildBaseInit(
                      0,
                      type === "mouseup"
                          ? 0
                          : overlaySyntheticPrimaryButtonDown || type === "mousedown"
                            ? 1
                            : 0,
                  );
        const pointerInit: PointerEventInit = {
            ...baseInit,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
        };
        const shouldResolveLiveOverlayTarget =
            deps.isLinking() && (type === "mousemove" || type === "mouseup");

        // A whole-sticker drag pins the target to #app-main below, so the
        // elementFromPoint hit-test would run — and be discarded — on every
        // un-throttled drag-move event. elementFromPoint forces a synchronous
        // layout while nodes/links are re-rendering, which shows up as
        // intermittent drag stutter. Skip it when we already know the target.
        const pinDragTargetToAppMain =
            type === "mousemove" &&
            overlaySyntheticPrimaryButtonDown &&
            !!deps.getDraggingStickerId();

        let target: EventTarget | null = pinDragTargetToAppMain
            ? appMain ?? win
            : type === "mousemove" && !overlaySyntheticPrimaryButtonDown
              ? resolveTarget(false)
              : resolveTarget(true);
        const shouldBypassSyntheticPointerCapture =
            type === "mousedown" &&
            !!payload.shiftKey &&
            isStickerInteractionRootTarget(target);
        if (type === "mousedown") {
            if (shouldBypassSyntheticPointerCapture) {
                overlaySyntheticPointerDownTarget = null;
                overlaySyntheticPointerDownPoint = null;
                resetOverlaySyntheticPointerState();
            } else {
                resetOverlaySyntheticPointerState();
                overlaySyntheticPointerTarget = target;
                overlaySyntheticPointerDownTarget = target;
                overlaySyntheticPointerDownInteractiveTarget = resolveInteractiveSyntheticTarget(target);
                overlaySyntheticPointerDownPoint = { x: clientX, y: clientY };
                overlaySyntheticPointerActive = true;
                overlaySyntheticPrimaryButtonDown = true;
                overlaySyntheticActiveGestureId = nextOverlaySyntheticGestureId();
            }
        } else if (shouldResolveLiveOverlayTarget) {
            target = resolveTarget(true);
        } else if (
            (type === "mousemove" || type === "mouseup") &&
            overlaySyntheticPointerActive &&
            overlaySyntheticPointerTarget
        ) {
            target = overlaySyntheticPointerTarget;
        }
        if (pinDragTargetToAppMain) {
            target = appMain ?? win;
        }

        if (!target) {
            dispatchHoverTransition(null, pointerInit, baseInit);
            return;
        }

        if (
            type === "mousedown" ||
            (type === "mousemove" && !overlaySyntheticPrimaryButtonDown) ||
            type === "contextmenu"
        ) {
            dispatchHoverTransition(target, pointerInit, baseInit);
        }
        if (type === "mousedown") {
            focusEditableSyntheticControl(target);
        }
        const relayedToJavaScriptSurface = relayJavaScriptSurfacePointer(target, type, payload);
        if (relayedToJavaScriptSurface) {
            // A JavaScript Surface owns the complete gesture once the native
            // shield sample has crossed the iframe boundary. Dispatching a
            // second DOM stream on the iframe element makes the parent UnitView
            // race the sandbox control/background classifier.
            if (type === "mouseup") {
                resetOverlaySyntheticPointerState();
            }
            return;
        }

        if (type !== "wheel" && type !== "contextmenu" && typeof PointerEvent !== "undefined") {
            target.dispatchEvent(
                new PointerEvent(
                    type === "mouseup"
                        ? "pointerup"
                        : type === "mousemove"
                          ? "pointermove"
                          : "pointerdown",
                    pointerInit,
                ),
            );
        }

        if (type === "wheel") {
            target.dispatchEvent(
                new WheelEvent("wheel", {
                    ...baseInit,
                    deltaY: payload.deltaY ?? 0,
                }),
            );
        } else if (type === "contextmenu") {
            target.dispatchEvent(new MouseEvent("contextmenu", baseInit));
        } else {
            target.dispatchEvent(new MouseEvent(type, baseInit));
        }

        if (type === "mouseup") {
            const releasedInteractiveTarget = resolveInteractiveSyntheticTarget(target);
            const interactiveClick =
                overlaySyntheticPointerDownInteractiveTarget !== null &&
                releasedInteractiveTarget === overlaySyntheticPointerDownInteractiveTarget &&
                overlaySyntheticPointerDownPoint &&
                Math.hypot(
                    clientX - overlaySyntheticPointerDownPoint.x,
                    clientY - overlaySyntheticPointerDownPoint.y,
                ) <= OVERLAY_SYNTHETIC_INTERACTIVE_CLICK_MAX_DISTANCE;
            if (
                overlaySyntheticPointerDownTarget &&
                overlaySyntheticPointerDownTarget === target &&
                overlaySyntheticPointerDownPoint &&
                (interactiveClick || Math.hypot(
                    clientX - overlaySyntheticPointerDownPoint.x,
                    clientY - overlaySyntheticPointerDownPoint.y,
                ) <= OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE)
            ) {
                focusEditableSyntheticControl(target);
                target.dispatchEvent(new MouseEvent("click", buildBaseInit(0, 0)));
                const clickTime = now();
                const isDoubleClick =
                    overlaySyntheticLastClickTarget === target &&
                    overlaySyntheticLastClickPoint &&
                    clickTime - overlaySyntheticLastClickAt <= OVERLAY_SYNTHETIC_DOUBLE_CLICK_MAX_DELAY_MS &&
                    Math.hypot(
                        clientX - overlaySyntheticLastClickPoint.x,
                        clientY - overlaySyntheticLastClickPoint.y,
                    ) <= OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE;
                if (isDoubleClick) {
                    target.dispatchEvent(new MouseEvent("dblclick", buildBaseInit(0, 0)));
                    overlaySyntheticLastClickTarget = null;
                    overlaySyntheticLastClickPoint = null;
                    overlaySyntheticLastClickAt = 0;
                } else {
                    overlaySyntheticLastClickTarget = target;
                    overlaySyntheticLastClickPoint = { x: clientX, y: clientY };
                    overlaySyntheticLastClickAt = clickTime;
                }
            }
            resetOverlaySyntheticPointerState();
        }
    };

    const relayOverlaySyntheticPointerMove = (event: MouseEvent) => {
        if (
            !overlaySyntheticPointerActive ||
            !overlaySyntheticPrimaryButtonDown ||
            !overlaySyntheticPointerTarget ||
            event.target === overlaySyntheticPointerTarget
        ) {
            return;
        }

        const baseInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: event.clientX,
            clientY: event.clientY,
            screenX: event.screenX,
            screenY: event.screenY,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
            metaKey: event.metaKey,
            button: 0,
            buttons: event.buttons,
        };

        overlaySyntheticMoveRelayActive = true;
        try {
            const relayedToJavaScriptSurface = relayJavaScriptSurfacePointer(
                overlaySyntheticPointerTarget,
                "mousemove",
                {
                x: event.clientX,
                y: event.clientY,
                globalX: event.screenX,
                globalY: event.screenY,
                ctrlKey: event.ctrlKey,
                altKey: event.altKey,
                shiftKey: event.shiftKey,
                metaKey: event.metaKey,
                },
            );
            if (relayedToJavaScriptSurface) return;
            if (typeof PointerEvent !== "undefined") {
                overlaySyntheticPointerTarget.dispatchEvent(
                    new PointerEvent("pointermove", {
                        ...baseInit,
                        pointerId: 1,
                        pointerType: "mouse",
                        isPrimary: true,
                    }),
                );
            }
            overlaySyntheticPointerTarget.dispatchEvent(new MouseEvent("mousemove", baseInit));
        } finally {
            overlaySyntheticMoveRelayActive = false;
        }
    };

    return {
        dispatch: dispatchSyntheticOverlayMouseEvent,
        relayPointerMove: relayOverlaySyntheticPointerMove,
        reset: resetOverlaySyntheticPointerState,
        get moveRelayActive() {
            return overlaySyntheticMoveRelayActive;
        },
    };
}
