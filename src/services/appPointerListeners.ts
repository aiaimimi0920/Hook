import { listen } from "@tauri-apps/api/event";

import { draggingStickerId, isSelecting, setMousePos } from "../store/uiStore";
import { resolveCaptureCtrlModifier } from "./captureState";
import type { AppListenerRegistry } from "./appListenerRegistry";
import { runBackgroundTask } from "./backgroundTask";
import {
    OVERLAY_GLOBAL_MOUSE_UP_EVENT,
    type OverlaySyntheticDispatcher,
    type OverlaySyntheticMousePayload,
} from "./overlaySyntheticEvents";

export type AppCaptureInputState = {
    nativePointerActive: boolean;
    ctrlReleasedSinceCaptureStart: boolean;
};

type CaptureMouseEvent = Pick<
    MouseEvent,
    "clientX" | "clientY" | "shiftKey" | "ctrlKey" | "target"
>;

type AppPointerListenerDependencies = {
    registry: AppListenerRegistry;
    captureInput: AppCaptureInputState;
    overlaySynthetic: OverlaySyntheticDispatcher;
    handleSelectionStart: (event: CaptureMouseEvent) => void;
    handleSelectionMove: (event: CaptureMouseEvent) => void;
    handleSelectionEnd: (event: CaptureMouseEvent) => void | Promise<void>;
    abortCaptureSelection: (reason: string) => Promise<void>;
    handleDragMove: (event: MouseEvent) => void;
};

type NativeCaptureMousePayload = {
    x?: number;
    y?: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
};

const toOverlayDragMouseEvent = (payload: OverlaySyntheticMousePayload) =>
    new MouseEvent("mousemove", {
        clientX: payload.x ?? payload.globalX ?? 0,
        clientY: payload.y ?? payload.globalY ?? 0,
        screenX: payload.globalX ?? payload.x ?? 0,
        screenY: payload.globalY ?? payload.y ?? 0,
        ctrlKey: !!payload.ctrlKey,
        altKey: !!payload.altKey,
        shiftKey: !!payload.shiftKey,
        metaKey: !!payload.metaKey,
        buttons: 1,
    });

/** Registers native capture and overlay pointer relays for one app mount. */
export async function registerAppPointerListeners({
    registry,
    captureInput,
    overlaySynthetic,
    handleSelectionStart,
    handleSelectionMove,
    handleSelectionEnd,
    abortCaptureSelection,
    handleDragMove,
}: AppPointerListenerDependencies): Promise<void> {
    const toCaptureMouseEvent = (payload: NativeCaptureMousePayload): CaptureMouseEvent => {
        const ctrlModifier = resolveCaptureCtrlModifier(
            captureInput.ctrlReleasedSinceCaptureStart,
            !!payload?.ctrlKey,
        );
        captureInput.ctrlReleasedSinceCaptureStart = ctrlModifier.releasedSinceCaptureStart;
        return {
            clientX: payload?.x ?? 0,
            clientY: payload?.y ?? 0,
            shiftKey: !!payload?.shiftKey,
            ctrlKey: ctrlModifier.effectiveCtrlKey,
            target: document.getElementById("app-main") as HTMLElement,
        };
    };

    await registry.register(() => listen<NativeCaptureMousePayload>(
        "capture/global_mouse_down",
        (event) => {
            if (!isSelecting() || captureInput.nativePointerActive) return;
            captureInput.nativePointerActive = true;
            const captureEvent = toCaptureMouseEvent(event.payload);
            setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });
            handleSelectionStart(captureEvent);
        },
    ));

    await registry.register(() => listen<NativeCaptureMousePayload>(
        "capture/global_mouse_move",
        (event) => {
            if (!isSelecting()) return;
            const captureEvent = toCaptureMouseEvent(event.payload);
            setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });
            handleSelectionMove(captureEvent);
        },
    ));

    await registry.register(() => listen<NativeCaptureMousePayload>(
        "capture/global_mouse_up",
        (event) => {
            if (!isSelecting()) return;
            if (!captureInput.nativePointerActive) {
                captureInput.ctrlReleasedSinceCaptureStart = false;
                runBackgroundTask(
                    "unpaired capture mouse-up cleanup",
                    abortCaptureSelection("unpaired-up"),
                );
                return;
            }
            captureInput.nativePointerActive = false;
            const captureEvent = toCaptureMouseEvent(event.payload);
            setMousePos({ x: captureEvent.clientX, y: captureEvent.clientY });
            handleSelectionMove(captureEvent);
            runBackgroundTask(
                "capture selection end",
                Promise.resolve().then(() => handleSelectionEnd(captureEvent)),
            );
            captureInput.ctrlReleasedSinceCaptureStart = false;
        },
    ));

    await registry.register(() => listen<OverlaySyntheticMousePayload>(
        "overlay/global_mouse_down",
        (event) => {
            if (event.payload?.nativeDragPreflight) {
                window.dispatchEvent(new CustomEvent("hook:overlay-native-drag-preflight-down", {
                    detail: event.payload,
                }));
            } else {
                overlaySynthetic.dispatch("mousedown", event.payload);
            }
        },
    ));

    await registry.register(() => listen<OverlaySyntheticMousePayload>(
        "overlay/global_mouse_move",
        (event) => {
            if (event.payload?.nativeDragPreflight) {
                window.dispatchEvent(new CustomEvent("hook:overlay-native-drag-preflight-move", {
                    detail: event.payload,
                }));
            } else if (draggingStickerId()) {
                handleDragMove(toOverlayDragMouseEvent(event.payload));
            } else {
                overlaySynthetic.dispatch("mousemove", event.payload);
            }
        },
    ));

    await registry.register(() => listen<OverlaySyntheticMousePayload>(
        "overlay/global_mouse_up",
        (event) => {
            if (event.payload?.nativeDragPreflight) {
                window.dispatchEvent(new CustomEvent("hook:overlay-native-drag-preflight-up", {
                    detail: event.payload,
                }));
            } else {
                window.dispatchEvent(new CustomEvent(OVERLAY_GLOBAL_MOUSE_UP_EVENT, {
                    detail: event.payload,
                }));
                overlaySynthetic.dispatch("mouseup", event.payload);
            }
        },
    ));

    await registry.register(() => listen<OverlaySyntheticMousePayload>(
        "overlay/global_mouse_wheel",
        (event) => overlaySynthetic.dispatch("wheel", event.payload),
    ));

    await registry.register(() => listen<OverlaySyntheticMousePayload>(
        "overlay/global_context_menu",
        (event) => overlaySynthetic.dispatch("contextmenu", event.payload),
    ));
}
