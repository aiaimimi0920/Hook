import { dispatchOverlaySyntheticHoverTransition } from "./overlaySyntheticHover";
import {
    createOverlaySyntheticState,
    nextOverlaySyntheticGestureId,
    resetOverlaySyntheticState,
} from "./overlaySyntheticState";
import { createOverlaySyntheticTargets } from "./overlaySyntheticTargets";
import {
    JAVASCRIPT_SURFACE_POINTER_EVENT,
    OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE,
    OVERLAY_SYNTHETIC_DOUBLE_CLICK_MAX_DELAY_MS,
    OVERLAY_SYNTHETIC_INTERACTIVE_CLICK_MAX_DISTANCE,
} from "./overlaySyntheticTypes";
import type {
    JavaScriptSurfacePointerDetail,
    OverlaySyntheticDeps,
    OverlaySyntheticDispatcher,
    OverlaySyntheticEventType,
    OverlaySyntheticMousePayload,
} from "./overlaySyntheticTypes";

const firstFiniteCoordinate = (...values: Array<number | undefined>): number => {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return 0;
};

/** Build an isolated DOM-event synthesizer for one overlay host. */
export function createOverlaySyntheticDispatcher(
    deps: OverlaySyntheticDeps,
): OverlaySyntheticDispatcher {
    const { doc } = deps;
    const win = deps.win ?? doc.defaultView ?? (globalThis as unknown as Window);
    const now = deps.now ?? (() => Date.now());
    const state = createOverlaySyntheticState();
    const targets = createOverlaySyntheticTargets(deps, win);

    const relayJavaScriptSurfacePointer = (
        target: EventTarget,
        type: OverlaySyntheticEventType,
        payload: OverlaySyntheticMousePayload,
    ): boolean => {
        const frame = targets.resolveJavaScriptSurfaceFrame(target);
        if (!frame || frame.dataset.javascriptSurfaceInteractive === "false") return false;
        // Refocusing on move/up would replace focus established by the
        // sandbox-side hit test before the user can type or click.
        if (type === "mousedown") frame.focus();
        frame.dispatchEvent(new CustomEvent<JavaScriptSurfacePointerDetail>(
            JAVASCRIPT_SURFACE_POINTER_EVENT,
            {
                detail: {
                    ...payload,
                    type,
                    gestureId: state.activeGestureId ?? undefined,
                },
            },
        ));
        return true;
    };

    const dispatchSyntheticOverlayMouseEvent = (
        type: OverlaySyntheticEventType,
        payload: OverlaySyntheticMousePayload,
    ): void => {
        if (typeof doc === "undefined" || !doc) return;

        // Native/plugin boundaries are not type-safe at runtime. Keep invalid
        // numeric payloads out of hit testing and DOM event constructors.
        const clientX = firstFiniteCoordinate(payload.x, payload.globalX);
        const clientY = firstFiniteCoordinate(payload.y, payload.globalY);
        const appMain = targets.getAppMain();
        const buildBaseInit = (button: number, buttons: number) => ({
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX,
            clientY,
            screenX: firstFiniteCoordinate(payload.globalX, clientX),
            screenY: firstFiniteCoordinate(payload.globalY, clientY),
            ctrlKey: !!payload.ctrlKey,
            altKey: !!payload.altKey,
            shiftKey: !!payload.shiftKey,
            metaKey: !!payload.metaKey,
            button,
            buttons,
        });
        const baseInit = type === "contextmenu"
            ? buildBaseInit(2, 0)
            : buildBaseInit(
                0,
                type === "mouseup"
                    ? 0
                    : state.primaryButtonDown || type === "mousedown"
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

        // Whole-sticker dragging pins to #app-main. Avoid a discarded
        // elementFromPoint call, which forces layout on every raw move sample.
        const pinDragTargetToAppMain =
            type === "mousemove"
            && state.primaryButtonDown
            && !!deps.getDraggingStickerId();
        let target: EventTarget | null = pinDragTargetToAppMain
            ? appMain ?? win
            : type === "mousemove" && !state.primaryButtonDown
                ? targets.resolveTarget(clientX, clientY, false, appMain)
                : targets.resolveTarget(clientX, clientY, true, appMain);
        const shouldBypassSyntheticPointerCapture =
            type === "mousedown"
            && !!payload.shiftKey
            && targets.isStickerInteractionRootTarget(target);

        if (type === "mousedown") {
            if (shouldBypassSyntheticPointerCapture) {
                state.pointerDownTarget = null;
                state.pointerDownPoint = null;
                resetOverlaySyntheticState(state);
            } else {
                resetOverlaySyntheticState(state);
                state.pointerTarget = target;
                state.pointerDownTarget = target;
                state.pointerDownInteractiveTarget = targets.resolveInteractiveSyntheticTarget(target);
                state.pointerDownPoint = { x: clientX, y: clientY };
                state.pointerActive = true;
                state.primaryButtonDown = true;
                state.activeGestureId = nextOverlaySyntheticGestureId(state);
            }
        } else if (shouldResolveLiveOverlayTarget) {
            target = targets.resolveTarget(clientX, clientY, true, appMain);
        } else if (
            (type === "mousemove" || type === "mouseup")
            && state.pointerActive
            && state.pointerTarget
        ) {
            target = state.pointerTarget;
        }
        if (pinDragTargetToAppMain) target = appMain ?? win;

        if (!target) {
            dispatchOverlaySyntheticHoverTransition(state, null, pointerInit, baseInit);
            return;
        }
        if (
            type === "mousedown"
            || (type === "mousemove" && !state.primaryButtonDown)
            || type === "contextmenu"
        ) {
            dispatchOverlaySyntheticHoverTransition(state, target, pointerInit, baseInit);
        }
        if (type === "mousedown") targets.focusEditableSyntheticControl(target);

        const relayedToJavaScriptSurface = relayJavaScriptSurfacePointer(target, type, payload);
        if (relayedToJavaScriptSurface) {
            // A Surface owns the complete stream after the sample crosses its
            // iframe boundary; a second parent-DOM stream would race it.
            if (type === "mouseup") resetOverlaySyntheticState(state);
            return;
        }

        if (type !== "wheel" && type !== "contextmenu" && typeof PointerEvent !== "undefined") {
            target.dispatchEvent(new PointerEvent(
                type === "mouseup"
                    ? "pointerup"
                    : type === "mousemove"
                        ? "pointermove"
                        : "pointerdown",
                pointerInit,
            ));
        }
        if (type === "wheel") {
            target.dispatchEvent(new WheelEvent("wheel", {
                ...baseInit,
                deltaY: payload.deltaY ?? 0,
            }));
        } else if (type === "contextmenu") {
            target.dispatchEvent(new MouseEvent("contextmenu", baseInit));
        } else {
            target.dispatchEvent(new MouseEvent(type, baseInit));
        }

        if (type === "mouseup") {
            const releasedInteractiveTarget = targets.resolveInteractiveSyntheticTarget(target);
            const interactiveClick =
                state.pointerDownInteractiveTarget !== null
                && releasedInteractiveTarget === state.pointerDownInteractiveTarget
                && state.pointerDownPoint
                && Math.hypot(
                    clientX - state.pointerDownPoint.x,
                    clientY - state.pointerDownPoint.y,
                ) <= OVERLAY_SYNTHETIC_INTERACTIVE_CLICK_MAX_DISTANCE;
            if (
                state.pointerDownTarget
                && state.pointerDownTarget === target
                && state.pointerDownPoint
                && (interactiveClick || Math.hypot(
                    clientX - state.pointerDownPoint.x,
                    clientY - state.pointerDownPoint.y,
                ) <= OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE)
            ) {
                targets.focusEditableSyntheticControl(target);
                target.dispatchEvent(new MouseEvent("click", buildBaseInit(0, 0)));
                const clickTime = now();
                const isDoubleClick =
                    state.lastClickTarget === target
                    && state.lastClickPoint
                    && clickTime - state.lastClickAt <= OVERLAY_SYNTHETIC_DOUBLE_CLICK_MAX_DELAY_MS
                    && Math.hypot(
                        clientX - state.lastClickPoint.x,
                        clientY - state.lastClickPoint.y,
                    ) <= OVERLAY_SYNTHETIC_CLICK_MAX_DISTANCE;
                if (isDoubleClick) {
                    target.dispatchEvent(new MouseEvent("dblclick", buildBaseInit(0, 0)));
                    state.lastClickTarget = null;
                    state.lastClickPoint = null;
                    state.lastClickAt = 0;
                } else {
                    state.lastClickTarget = target;
                    state.lastClickPoint = { x: clientX, y: clientY };
                    state.lastClickAt = clickTime;
                }
            }
            resetOverlaySyntheticState(state);
        }
    };

    const relayOverlaySyntheticPointerMove = (event: MouseEvent): void => {
        if (
            !state.pointerActive
            || !state.primaryButtonDown
            || !state.pointerTarget
            || event.target === state.pointerTarget
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

        state.moveRelayActive = true;
        try {
            const relayedToJavaScriptSurface = relayJavaScriptSurfacePointer(
                state.pointerTarget,
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
                state.pointerTarget.dispatchEvent(new PointerEvent("pointermove", {
                    ...baseInit,
                    pointerId: 1,
                    pointerType: "mouse",
                    isPrimary: true,
                }));
            }
            state.pointerTarget.dispatchEvent(new MouseEvent("mousemove", baseInit));
        } finally {
            state.moveRelayActive = false;
        }
    };

    return {
        dispatch: dispatchSyntheticOverlayMouseEvent,
        relayPointerMove: relayOverlaySyntheticPointerMove,
        reset: () => resetOverlaySyntheticState(state),
        get moveRelayActive() {
            return state.moveRelayActive;
        },
    };
}
