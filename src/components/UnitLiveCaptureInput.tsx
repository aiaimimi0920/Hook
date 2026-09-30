import { createEffect, onCleanup, onMount, Show, For, type Component } from "solid-js";
import type { Unit } from "../types/unit";
import { liveCaptureViews } from "../store/liveCaptureStore";
import { activeStickerEditTargetId, draggingStickerId, selectionActions } from "../store/uiStore";
import { api } from "../services/api";
import { ShortcutManager } from "../services/shortcuts";
import { liveMouseButton, liveNormalizedPoint, liveVirtualKey, liveWheelPayload, releaseLivePointer, tryCaptureLivePointer } from "../services/liveCaptureInput";
import { sendLiveCaptureUnitInput } from "../services/liveCaptureUnit";
import { showLiveCaptureControlError } from "../services/liveCaptureFeedback";
import { OVERLAY_GLOBAL_MOUSE_UP_EVENT, type OverlaySyntheticMousePayload } from "../services/overlaySyntheticEvents";
import type { LiveCaptureInputPayload } from "../services/liveCapture";
import "./UnitLiveCaptureInput.css";

const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

/** Live owns source input only; UnitView owns selection, shortcuts and dragging. */
export const UnitLiveCaptureInput: Component<{
    unit: Unit;
    element?: HTMLElement;
    onMouseDown: (event: MouseEvent) => void;
}> = (props) => {
    const view = () => liveCaptureViews.find((item) => item.sessionId === props.unit.id);
    const acceptsContentInput = () => !props.unit.data.minified
        && activeStickerEditTargetId() !== props.unit.id;
    const controlsSource = () => acceptsContentInput() && Boolean(view()?.status.interactionEnabled);
    const buttons = new Set<"left" | "right" | "middle">();
    const keys = new Set<number>();
    let lastPoint = { normalizedX: 0.5, normalizedY: 0.5 };
    let lastPress: { at: number; x: number; y: number; button: string } | undefined;

    const send = (input: LiveCaptureInputPayload) =>
        sendLiveCaptureUnitInput(props.unit.id, input).catch(() => undefined);
    const pointAt = (x: number, y: number, clamp = false) => {
        const image = props.element?.querySelector<HTMLImageElement>("[data-sticker-base-image]");
        const status = view()?.status;
        if (!image || !status) return undefined;
        const fit = props.unit.data.imageEditState?.cropRect ? "fill" : "contain";
        const point = liveNormalizedPoint(image.getBoundingClientRect(), status, x, y, clamp, fit);
        if (!point) return undefined;
        lastPoint = {
            normalizedX: props.unit.data.imageEditState?.flippedX ? 1 - point.normalizedX : point.normalizedX,
            normalizedY: props.unit.data.imageEditState?.flippedY ? 1 - point.normalizedY : point.normalizedY,
        };
        return lastPoint;
    };
    const release = () => {
        // Enqueue all edges synchronously before a new gesture can enqueue down.
        for (const button of buttons) void send({ kind: "mouse_button_up", button, ...lastPoint });
        for (const virtualKey of keys) void send({ kind: "key_up", virtualKey });
        buttons.clear();
        keys.clear();
    };
    const globalUp = (event: Event) => {
        const detail = (event as CustomEvent<OverlaySyntheticMousePayload>).detail;
        if (detail && typeof detail.x === "number" && typeof detail.y === "number") {
            pointAt(detail.x, detail.y, true);
        }
        // The normal pointerup gets first ownership of the exact release point.
        // This fallback still releases when native hit testing has lost the target.
        queueMicrotask(release);
    };
    const onHidden = () => { if (document.visibilityState === "hidden") release(); };
    onMount(() => {
        window.addEventListener(OVERLAY_GLOBAL_MOUSE_UP_EVENT, globalUp);
        window.addEventListener("blur", release);
        window.addEventListener("pointercancel", release, true);
        document.addEventListener("visibilitychange", onHidden);
    });
    onCleanup(() => {
        release();
        window.removeEventListener(OVERLAY_GLOBAL_MOUSE_UP_EVENT, globalUp);
        window.removeEventListener("blur", release);
        window.removeEventListener("pointercancel", release, true);
        document.removeEventListener("visibilitychange", onHidden);
    });
    createEffect(() => { if (!controlsSource()) release(); });

    return <Show when={view()}>
        <div class="unit-live-border" style={{ height: `${props.unit.h}px` }} aria-hidden="true" />
        <Show when={acceptsContentInput()}>
            <div
                class="unit-live-input"
                style={{ height: `${props.unit.h}px` }}
                data-live-capture-session-id={props.unit.id}
                data-overlay-synthetic-target="direct"
                tabIndex={-1}
                onPointerDown={(event) => {
                    if (event.altKey || event.shiftKey) return;
                    selectionActions.set([props.unit.id]);
                    event.preventDefault();
                    event.stopPropagation();
                    if (!controlsSource()) {
                        const current = view();
                        showLiveCaptureControlError(props.unit.id,
                            current?.controlErrorCode ?? current?.status.inputCapability ?? "live_control_failed");
                        return;
                    }
                    const button = liveMouseButton(event.button);
                    const point = pointAt(event.clientX, event.clientY);
                    if (!button || !point) return;
                    event.currentTarget.focus({ preventScroll: true });
                    void api.focusOverlayWindow();
                    tryCaptureLivePointer(event.currentTarget, event.pointerId, event.isTrusted);
                    buttons.add(button);
                    const doubleClick = lastPress?.button === button
                        && event.timeStamp - lastPress.at <= 450
                        && Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) <= 5;
                    lastPress = doubleClick ? undefined : {
                        at: event.timeStamp, x: event.clientX, y: event.clientY, button,
                    };
                    void send({ kind: "mouse_button_down", button, ...point, ...(doubleClick ? { clickCount: 2 } : {}) });
                }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.altKey || event.shiftKey) props.onMouseDown(event);
                }}
                onPointerMove={(event) => {
                    if (!controlsSource() || draggingStickerId()) return;
                    const point = pointAt(event.clientX, event.clientY, buttons.size > 0);
                    if (point) void send({ kind: "mouse_move", ...point });
                }}
                onPointerUp={(event) => {
                    const button = liveMouseButton(event.button);
                    if (!button || !buttons.delete(button)) return;
                    const point = pointAt(event.clientX, event.clientY, true) ?? lastPoint;
                    void send({ kind: "mouse_button_up", button, ...point });
                    releaseLivePointer(event.currentTarget, event.pointerId);
                }}
                onPointerCancel={release}
                onLostPointerCapture={release}
                onContextMenu={(event) => {
                    if (event.altKey) return;
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onDblClick={(event) => { if (!event.altKey) event.stopPropagation(); }}
                onWheel={(event) => {
                    if (ShortcutManager.isGestureActive(event, "sticker_resize")
                        || ShortcutManager.isGestureActive(event, "sticker_opacity")) return;
                    if (!controlsSource()) return;
                    const point = pointAt(event.clientX, event.clientY);
                    if (!point) return;
                    event.preventDefault();
                    event.stopPropagation();
                    void send({ kind: "mouse_wheel", ...liveWheelPayload(event), ...point });
                }}
                onKeyDown={(event) => {
                    // Shared Hook shortcuts run first in the global capture phase.
                    if (!controlsSource() || event.defaultPrevented || event.repeat) return;
                    const virtualKey = liveVirtualKey(event);
                    if (!virtualKey) return;
                    keys.add(virtualKey);
                    event.preventDefault();
                    event.stopPropagation();
                    void send({ kind: "key_down", virtualKey });
                }}
                onKeyUp={(event) => {
                    const virtualKey = liveVirtualKey(event);
                    if (!virtualKey || !keys.delete(virtualKey)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    void send({ kind: "key_up", virtualKey });
                }}
            />
        </Show>
        <For each={CORNERS}>{(corner) => <span
            class={`unit-live-corner unit-live-corner--${corner}`}
            style={{ top: corner.startsWith("bottom") ? `${props.unit.h - 16}px` : "0" }}
            data-live-capture-move-corner={corner}
            data-overlay-synthetic-target="direct"
            onMouseDown={(event) => props.onMouseDown(event)}
            aria-hidden="true"
        />}</For>
    </Show>;
};
