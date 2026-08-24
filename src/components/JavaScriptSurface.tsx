import {
    Component,
    Show,
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
} from "solid-js";

import {
    SURFACE_PROTOCOL_VERSION,
    type SurfaceEventClass,
} from "../services/surfaceProtocol";
import {
    JAVASCRIPT_SURFACE_POINTER_EVENT,
    type JavaScriptSurfacePointerDetail,
} from "../services/overlaySyntheticEvents";
import {
    EDITABLE_FOCUS_RELEASE_EVENT,
    NATIVE_APP_FOCUS_EVENT,
    isNativeAppFocused,
    type EditableFocusReleaseDetail,
    type NativeAppFocusDetail,
} from "../services/editableFocus";
import {
    isRelayableSurfaceHostKeydown,
    markSurfaceRelayedKeydown,
} from "../services/surfaceHostKeydown";
import { DeclarativeSurface } from "./DeclarativeSurface";
import {
    cloneSurfaceJson,
    consumeJavaScriptSurfaceEventBudget,
    finiteCoordinate,
    javaScriptSurfaceBudgetFailure,
    javaScriptSurfaceHeartbeatStatus,
    javaScriptSurfaceRecoveryUrl,
    javaScriptSurfaceResourceBudgetFailure,
    parseJavaScriptSurfaceDataUrl,
    randomIdentity,
    validateJavaScriptSurfaceEvent,
    validateJavaScriptSurfaceHostDragPointer,
    validateJavaScriptSurfaceHostDragStart,
    validateJavaScriptSurfaceHostKeydown,
    validateJavaScriptSurfaceHostWheel,
    type JavaScriptSurfaceEventBudgetWindow,
    type JavaScriptSurfaceProps,
    type JavaScriptSurfaceRuntimeMessage,
} from "./javascriptSurfaceContracts";
import {
    resolveJavaScriptSurfaceFrameGeometry,
    resolveJavaScriptSurfaceFramePoint,
    resolveJavaScriptSurfaceHostClientPoint,
} from "./javascriptSurfaceGeometry";
import "./JavaScriptSurface.css";

export {
    JAVASCRIPT_SURFACE_BUDGETS,
    cloneSurfaceJson,
    consumeJavaScriptSurfaceEventBudget,
    javaScriptSurfaceBudgetFailure,
    javaScriptSurfaceHeartbeatStatus,
    javaScriptSurfaceRecoveryUrl,
    javaScriptSurfaceResourceBudgetFailure,
    javaScriptSurfaceUtf8ByteLength,
    parseJavaScriptSurfaceDataUrl,
    validateJavaScriptSurfaceEvent,
    validateJavaScriptSurfaceHostDragPointer,
    validateJavaScriptSurfaceHostDragStart,
    validateJavaScriptSurfaceHostKeydown,
    validateJavaScriptSurfaceHostWheel,
} from "./javascriptSurfaceContracts";
export type {
    JavaScriptSurfaceBudgetSample, JavaScriptSurfaceEventBudgetWindow,
    JavaScriptSurfaceHeartbeatStatus, JavaScriptSurfaceHostDragPointer,
    JavaScriptSurfaceHostDragStart, JavaScriptSurfaceHostKeydown, JavaScriptSurfaceHostWheel,
} from "./javascriptSurfaceContracts";
export {
    resolveJavaScriptSurfaceFrameGeometry,
    resolveJavaScriptSurfaceFramePoint,
} from "./javascriptSurfaceGeometry";
export type { JavaScriptSurfaceFrameGeometry, JavaScriptSurfaceFramePoint } from "./javascriptSurfaceGeometry";

export const JavaScriptSurface: Component<JavaScriptSurfaceProps> = (props) => {
    let iframe: HTMLIFrameElement | undefined;
    let port: MessagePort | undefined;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let lastHeartbeat = 0;
    let lastWatchdogTick = 0;
    let runtimeRecoveryAttempt = 0;
    let nativeAppFocused = isNativeAppFocused();
    let activeHostDragGestureId: number | null = null;
    let eventBudgetWindow: JavaScriptSurfaceEventBudgetWindow = {
        windowStartedAt: 0,
        count: 0,
    };
    const [ready, setReady] = createSignal(false);
    const [runtimeError, setRuntimeError] = createSignal<string>();
    const token = randomIdentity("surface-token");
    const entryResource = createMemo(() => {
        const resourceId = props.snapshot.entryResourceId;
        return parseJavaScriptSurfaceDataUrl(resourceId ? props.resolveResource(resourceId) : undefined);
    });
    const documentUrl = new URL(
        "/javascript-surface-host.html",
        globalThis.location.href,
    ).href;
    const resolvedResources = () => Object.fromEntries(
        (props.snapshot.resourceLeases ?? [])
            .map((lease) => [lease.resource.resourceId, props.resolveResource(lease.resource.resourceId)] as const)
            .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string"),
    );
    const displayScale = () => {
        const value = Number(props.displayScale);
        return Number.isFinite(value) && value > 0 ? value : 1;
    };

    const relaySyntheticPointer = (event: Event): void => {
        if (!port || !iframe || props.interactive === false) return;
        const detail = (event as CustomEvent<JavaScriptSurfacePointerDetail>).detail;
        if (!detail || !["mousedown", "mousemove", "mouseup", "wheel", "contextmenu"].includes(detail.type)) {
            return;
        }
        const clientX = finiteCoordinate(detail.x) ? detail.x : detail.globalX;
        const clientY = finiteCoordinate(detail.y) ? detail.y : detail.globalY;
        if (!finiteCoordinate(clientX) || !finiteCoordinate(clientY)) return;
        const geometry = resolveJavaScriptSurfaceFrameGeometry(iframe, displayScale());
        const point = resolveJavaScriptSurfaceFramePoint(
            geometry,
            Number(clientX),
            Number(clientY),
        );
        const gestureId = Number.isSafeInteger(detail.gestureId) && Number(detail.gestureId) > 0
            ? Number(detail.gestureId)
            : undefined;
        port.postMessage({
            type: "pointer",
            token,
            pointer: {
                type: detail.type,
                gestureId,
                x: point.x,
                y: point.y,
                normalizedX: point.normalizedX,
                normalizedY: point.normalizedY,
                ctrlKey: detail.ctrlKey === true,
                altKey: detail.altKey === true,
                shiftKey: detail.shiftKey === true,
                metaKey: detail.metaKey === true,
                deltaY: Number.isFinite(detail.deltaY) ? Number(detail.deltaY) : 0,
            },
        });
    };

    const releaseEditableFocus = (event: Event): void => {
        const detail = (event as CustomEvent<EditableFocusReleaseDetail>).detail;
        if (detail?.preserveUnitId === props.unitId) return;
        port?.postMessage({ type: "release-editable-focus", token });
    };
    const updateNativeAppFocus = (event: Event): void => {
        const detail = (event as CustomEvent<NativeAppFocusDetail>).detail;
        if (typeof detail?.focused === "boolean") nativeAppFocused = detail.focused;
    };
    window.addEventListener(EDITABLE_FOCUS_RELEASE_EVENT, releaseEditableFocus);
    window.addEventListener(NATIVE_APP_FOCUS_EVENT, updateNativeAppFocus);

    const closeRuntime = (sendDispose: boolean): void => {
        const activePort = port;
        port = undefined;
        activeHostDragGestureId = null;
        if (watchdog) clearInterval(watchdog);
        watchdog = undefined;
        setReady(false);
        try {
            if (sendDispose && activePort) activePort.postMessage({ type: "dispose", token });
        } catch {
            // The iframe may have already detached its port during teardown.
        } finally {
            try {
                activePort?.close();
            } catch {
                // Closing an already-detached MessagePort is best-effort cleanup.
            }
        }
    };

    const handleRuntimeMessage = (message: JavaScriptSurfaceRuntimeMessage): void => {
        if (!message || message.token !== token) return;
        if (message.type === "host-activate") {
            void Promise.resolve(props.onActivate?.())
                .catch(() => {
                    console.warn("[Hook] JavaScript Surface activation failed");
                })
                .finally(() => {
                    try {
                        port?.postMessage({ type: "restore-editable-focus", token });
                    } catch {
                        // Activation may finish after the iframe has already closed.
                    }
                });
            return;
        }
        if (message.type === "host-drag-start") {
            if (!validateJavaScriptSurfaceHostDragStart(message.pointer) || !iframe) return;
            if (activeHostDragGestureId !== null) return;
            const geometry = resolveJavaScriptSurfaceFrameGeometry(iframe, displayScale());
            if (
                message.pointer.x < 0
                || message.pointer.y < 0
                || message.pointer.x > geometry.localWidth
                || message.pointer.y > geometry.localHeight
            ) return;
            const clientPoint = resolveJavaScriptSurfaceHostClientPoint(geometry, message.pointer);
            activeHostDragGestureId = message.pointer.gestureId;
            props.onDragStart?.(new MouseEvent("mousedown", {
                bubbles: true,
                cancelable: true,
                clientX: clientPoint.x,
                clientY: clientPoint.y,
                button: 0,
                buttons: 1,
                ctrlKey: message.pointer.ctrlKey,
                altKey: message.pointer.altKey,
                shiftKey: message.pointer.shiftKey,
                metaKey: message.pointer.metaKey,
            }));
            return;
        }
        if (message.type === "host-drag-move" || message.type === "host-drag-end") {
            if (!validateJavaScriptSurfaceHostDragPointer(message.pointer) || !iframe) return;
            if (message.pointer.gestureId !== activeHostDragGestureId) return;
            const geometry = resolveJavaScriptSurfaceFrameGeometry(iframe, displayScale());
            const clientPoint = resolveJavaScriptSurfaceHostClientPoint(geometry, message.pointer);
            window.dispatchEvent(new MouseEvent(
                message.type === "host-drag-move" ? "mousemove" : "mouseup",
                {
                    bubbles: true,
                    cancelable: true,
                    clientX: clientPoint.x,
                    clientY: clientPoint.y,
                    button: message.pointer.button,
                    buttons: message.type === "host-drag-end" ? 0 : message.pointer.buttons,
                    ctrlKey: message.pointer.ctrlKey,
                    altKey: message.pointer.altKey,
                    shiftKey: message.pointer.shiftKey,
                    metaKey: message.pointer.metaKey,
                },
            ));
            if (message.type === "host-drag-end") activeHostDragGestureId = null;
            return;
        }
        if (message.type === "host-background-double-click") {
            if (!validateJavaScriptSurfaceHostDragPointer(message.pointer) || !iframe) return;
            const geometry = resolveJavaScriptSurfaceFrameGeometry(iframe, displayScale());
            if (
                message.pointer.normalizedX < 0
                || message.pointer.normalizedX > 1
                || message.pointer.normalizedY < 0
                || message.pointer.normalizedY > 1
            ) return;
            const clientPoint = resolveJavaScriptSurfaceHostClientPoint(geometry, message.pointer);
            iframe.dispatchEvent(new MouseEvent("dblclick", {
                bubbles: true,
                cancelable: true,
                clientX: clientPoint.x,
                clientY: clientPoint.y,
                button: 0,
                buttons: 0,
                ctrlKey: message.pointer.ctrlKey,
                altKey: message.pointer.altKey,
                shiftKey: message.pointer.shiftKey,
                metaKey: message.pointer.metaKey,
            }));
            return;
        }
        if (message.type === "host-wheel") {
            if (!validateJavaScriptSurfaceHostWheel(message.wheel) || !iframe) return;
            const geometry = resolveJavaScriptSurfaceFrameGeometry(iframe, displayScale());
            if (
                message.wheel.x < 0
                || message.wheel.y < 0
                || message.wheel.x > geometry.localWidth
                || message.wheel.y > geometry.localHeight
            ) return;
            const clientPoint = resolveJavaScriptSurfaceHostClientPoint(geometry, message.wheel);
            iframe.dispatchEvent(new WheelEvent("wheel", {
                bubbles: true,
                cancelable: true,
                clientX: clientPoint.x,
                clientY: clientPoint.y,
                deltaY: message.wheel.deltaY,
                ctrlKey: message.wheel.ctrlKey,
                altKey: message.wheel.altKey,
                shiftKey: message.wheel.shiftKey,
                metaKey: message.wheel.metaKey,
            }));
            return;
        }
        if (message.type === "host-keydown") {
            if (!validateJavaScriptSurfaceHostKeydown(message.keydown)) return;
            const keydown = message.keydown;
            // Shape validation admits any key with any modifier combination, so the
            // allowlist decides what a sandbox may actually reach, and the relay shares
            // the per-second event budget with surface events instead of running
            // unthrottled. The dispatched event is tagged so host keydown listeners can
            // ignore sandbox-originated keystrokes unless they opted in.
            if (!isRelayableSurfaceHostKeydown(keydown)) return;
            const keydownBudget = consumeJavaScriptSurfaceEventBudget(eventBudgetWindow, Date.now());
            eventBudgetWindow = keydownBudget.window;
            if (!keydownBudget.allowed) return;
            window.dispatchEvent(markSurfaceRelayedKeydown(new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                key: keydown.key,
                code: keydown.code,
                repeat: keydown.repeat,
                ctrlKey: keydown.ctrlKey,
                altKey: keydown.altKey,
                shiftKey: keydown.shiftKey,
                metaKey: keydown.metaKey,
            })));
            return;
        }
        if (message.type === "heartbeat") {
            const budgetFailure = javaScriptSurfaceBudgetFailure(message.budget);
            if (budgetFailure) {
                setRuntimeError(budgetFailure);
                closeRuntime(false);
                iframe?.remove();
                return;
            }
            lastHeartbeat = Date.now();
            return;
        }
        if (message.type === "failure") {
            setRuntimeError(typeof message.message === "string" ? message.message : "JavaScript Surface failed");
            closeRuntime(false);
            return;
        }
        if (message.type === "ready") {
            lastHeartbeat = Date.now();
            setReady(true);
            setRuntimeError(undefined);
            return;
        }
        const eventBudget = consumeJavaScriptSurfaceEventBudget(eventBudgetWindow, Date.now());
        eventBudgetWindow = eventBudget.window;
        if (!eventBudget.allowed || !message.event) return;
        const snapshot = props.snapshot;
        if (!validateJavaScriptSurfaceEvent(snapshot, message.event)) return;
        props.onEvent({
            protocolVersion: SURFACE_PROTOCOL_VERSION,
            instanceId: snapshot.instanceId,
            attachmentId: snapshot.attachmentId,
            eventId: randomIdentity("event"),
            nodeId: message.event.nodeId,
            event: message.event.event,
            action: message.event.action,
            class: message.event.class as SurfaceEventClass,
            generation: props.generation,
            baseRevision: snapshot.revision,
            payload: message.event.payload ?? null,
        });
    };

    const initializeRuntime = (): void => {
        const entry = entryResource();
        if (!iframe?.contentWindow || !entry) return;
        closeRuntime(false);
        const resources = resolvedResources();
        const resourceBudgetFailure = javaScriptSurfaceResourceBudgetFailure(resources);
        if (resourceBudgetFailure) {
            setRuntimeError(resourceBudgetFailure);
            iframe.remove();
            return;
        }
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = (event: MessageEvent<JavaScriptSurfaceRuntimeMessage>) => handleRuntimeMessage(event.data);
        port.start();
        lastHeartbeat = Date.now();
        lastWatchdogTick = lastHeartbeat;
        const transferableSnapshot = cloneSurfaceJson(props.snapshot);
        try {
            iframe.contentWindow.postMessage({
                type: "surface:init",
                token,
                entryBase64: entry.base64,
                snapshot: transferableSnapshot,
                resources,
            }, "*", [channel.port2]);
            port.postMessage({
                type: props.lifecycle === "suspended" || props.lifecycle === "inactive"
                    ? "suspend"
                    : "resume",
                token,
            });
        } catch {
            channel.port2.close();
            closeRuntime(false);
            setRuntimeError("JavaScript Surface failed to initialize");
            return;
        }
        watchdog = setInterval(() => {
            const now = Date.now();
            const heartbeatStatus = javaScriptSurfaceHeartbeatStatus({
                now,
                lastHeartbeat,
                lastWatchdogTick,
                documentVisible: document.visibilityState === "visible" && nativeAppFocused,
                lifecycle: props.lifecycle,
            });
            lastWatchdogTick = now;
            if (heartbeatStatus === "paused") {
                // WebView background throttling and OS sleep pause both host and
                // iframe timers. Do not turn that shared pause into a fatal iframe
                // failure; require a fresh full watchdog window after resuming.
                lastHeartbeat = now;
                return;
            }
            if (heartbeatStatus === "healthy" || heartbeatStatus === "recovering") return;
            setRuntimeError("JavaScript Surface exceeded its response budget");
            closeRuntime(false);
            if (iframe) {
                runtimeRecoveryAttempt += 1;
                iframe.src = javaScriptSurfaceRecoveryUrl(documentUrl, runtimeRecoveryAttempt);
            }
        }, 500);
    };

    createEffect(() => {
        const snapshot = props.snapshot;
        // Solid stores reconcile snapshots in place. Track the monotonic field
        // before the port guard so an initially unready iframe still receives
        // every later authoritative revision.
        const snapshotRevision = snapshot.revision;
        const snapshotViewId = snapshot.viewId;
        const resources = resolvedResources();
        if (!port) return;
        const resourceBudgetFailure = javaScriptSurfaceResourceBudgetFailure(resources);
        if (resourceBudgetFailure) {
            setRuntimeError(resourceBudgetFailure);
            closeRuntime(false);
            iframe?.remove();
            return;
        }
        port.postMessage({
            type: "snapshot",
            token,
            snapshotRevision,
            snapshotViewId,
            snapshot: cloneSurfaceJson(snapshot),
            resources,
        });
    });

    createEffect(() => {
        if (!port) return;
        port.postMessage({
            type: props.lifecycle === "suspended" || props.lifecycle === "inactive"
                ? "suspend"
                : "resume",
            token,
        });
    });

    onCleanup(() => {
        window.removeEventListener(EDITABLE_FOCUS_RELEASE_EVENT, releaseEditableFocus);
        window.removeEventListener(NATIVE_APP_FOCUS_EVENT, updateNativeAppFocus);
        iframe?.removeEventListener(JAVASCRIPT_SURFACE_POINTER_EVENT, relaySyntheticPointer);
        closeRuntime(true);
    });

    return (
        <div
            class="javascript-surface-host"
            data-runtime-error={runtimeError()}
            data-overlay-synthetic-target="direct"
            onPointerDown={(event) => {
                if (props.interactive !== false) event.stopPropagation();
            }}
            onMouseDown={(event) => {
                if (props.interactive !== false) event.stopPropagation();
            }}
        >
            <Show when={entryResource()}>
                <iframe
                    ref={(element) => {
                        iframe?.removeEventListener(JAVASCRIPT_SURFACE_POINTER_EVENT, relaySyntheticPointer);
                        iframe = element;
                        element.addEventListener(JAVASCRIPT_SURFACE_POINTER_EVENT, relaySyntheticPointer);
                    }}
                    class="javascript-surface-frame"
                    classList={{ "is-ready": ready() }}
                    sandbox="allow-scripts"
                    src={documentUrl}
                    tabindex={ready() && props.interactive !== false ? 0 : -1}
                    aria-label="Art Surface"
                    data-javascript-surface-frame="true"
                    data-javascript-surface-interactive={ready() && props.interactive !== false ? "true" : "false"}
                    data-overlay-synthetic-target="direct"
                    onLoad={initializeRuntime}
                    style={{
                        "pointer-events": ready() && props.interactive !== false ? "auto" : "none",
                    }}
                />
            </Show>
            <Show when={!ready()}>
                <div class="javascript-surface-fallback">
                    <DeclarativeSurface
                        unitId={props.unitId}
                        snapshot={props.snapshot}
                        generation={props.generation}
                        interactive={props.interactive}
                        resolveResource={props.resolveResource}
                        onEvent={props.onEvent}
                    />
                </div>
            </Show>
        </div>
    );
};
