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
    deltaY?: number;
    nativeDragPreflight?: boolean;
};

export type OverlaySyntheticEventType =
    | "mousedown"
    | "mousemove"
    | "mouseup"
    | "wheel"
    | "contextmenu";

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
const OVERLAY_SYNTHETIC_DOUBLE_CLICK_MAX_DELAY_MS = 320;

export interface OverlaySyntheticDispatcher {
    dispatch: (type: OverlaySyntheticEventType, payload: OverlaySyntheticMousePayload) => void;
    relayPointerMove: (event: MouseEvent) => void;
    reset: () => void;
    readonly moveRelayActive: boolean;
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
    let overlaySyntheticHoverTarget: EventTarget | null = null;
    let overlaySyntheticPointerDownPoint: { x: number; y: number } | null = null;
    let overlaySyntheticLastClickTarget: EventTarget | null = null;
    let overlaySyntheticLastClickPoint: { x: number; y: number } | null = null;
    let overlaySyntheticLastClickAt = 0;
    let overlaySyntheticPointerActive = false;
    let overlaySyntheticPrimaryButtonDown = false;
    let overlaySyntheticMoveRelayActive = false;

    const resetOverlaySyntheticPointerState = () => {
        overlaySyntheticPointerTarget = null;
        overlaySyntheticPointerActive = false;
        overlaySyntheticPrimaryButtonDown = false;
        overlaySyntheticMoveRelayActive = false;
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
                const stickerInteractionRoot =
                    rawTarget.closest?.("[data-sticker-interaction-root='true']") ?? null;
                if (stickerInteractionRoot) {
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

        let target: EventTarget | null =
            type === "mousemove" && !overlaySyntheticPrimaryButtonDown
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
                overlaySyntheticPointerDownPoint = { x: clientX, y: clientY };
                overlaySyntheticPointerActive = true;
                overlaySyntheticPrimaryButtonDown = true;
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
        if (type === "mousemove" && overlaySyntheticPrimaryButtonDown && deps.getDraggingStickerId()) {
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
            if (
                overlaySyntheticPointerDownTarget &&
                overlaySyntheticPointerDownTarget === target &&
                overlaySyntheticPointerDownPoint &&
                Math.hypot(
                    clientX - overlaySyntheticPointerDownPoint.x,
                    clientY - overlaySyntheticPointerDownPoint.y,
                ) <= OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE
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
            overlaySyntheticPointerDownTarget = null;
            overlaySyntheticPointerDownPoint = null;
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
            button: 0,
            buttons: event.buttons,
        };

        overlaySyntheticMoveRelayActive = true;
        try {
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
