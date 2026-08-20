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
    type SurfaceEvent,
    type SurfaceEventClass,
    type SurfaceLifecycleState,
    type SurfaceNode,
    type SurfaceSnapshot,
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
import { DeclarativeSurface } from "./DeclarativeSurface";
import "./JavaScriptSurface.css";

const MAX_JAVASCRIPT_SOURCE_BYTES = 512 * 1024;
const WATCHDOG_MILLIS = 3_000;
const WATCHDOG_RECOVERY_MILLIS = 30_000;
const SAFE_ID = /^[A-Za-z0-9._:/-]{1,160}$/;

export type JavaScriptSurfaceHeartbeatStatus = "healthy" | "paused" | "recovering" | "expired";

export const javaScriptSurfaceHeartbeatStatus = ({
    now,
    lastHeartbeat,
    lastWatchdogTick,
    documentVisible,
    lifecycle,
}: {
    now: number;
    lastHeartbeat: number;
    lastWatchdogTick: number;
    documentVisible: boolean;
    lifecycle: SurfaceLifecycleState;
}): JavaScriptSurfaceHeartbeatStatus => {
    if (
        ["inactive", "suspended", "disposed"].includes(lifecycle) ||
        !documentVisible ||
        now - lastWatchdogTick > WATCHDOG_MILLIS
    ) {
        return "paused";
    }
    const heartbeatSilence = now - lastHeartbeat;
    if (heartbeatSilence > WATCHDOG_RECOVERY_MILLIS) return "expired";
    return heartbeatSilence > WATCHDOG_MILLIS ? "recovering" : "healthy";
};

export const javaScriptSurfaceRecoveryUrl = (documentUrl: string, attempt: number): string => {
    const recoveryUrl = new URL(documentUrl);
    recoveryUrl.searchParams.set("surface-recovery", String(attempt));
    return recoveryUrl.href;
};

/** Normalize Solid store proxies before crossing a postMessage boundary. */
export function cloneSurfaceJson<T>(value: T): T {
    try {
        return structuredClone(value);
    } catch {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
            throw new Error("JavaScript Surface message is not JSON-serializable");
        }
        return JSON.parse(serialized) as T;
    }
}

export const JAVASCRIPT_SURFACE_BUDGETS = Object.freeze({
    maxEventPayloadBytes: 64 * 1024,
    maxEventsPerSecond: 120,
    maxHeapGrowthBytes: 64 * 1024 * 1024,
    maxCpuWindowMillis: 250,
    maxDomNodes: 1_000,
    maxTimers: 64,
    maxResourceEntries: 64,
    maxResourceTransferBytes: 64 * 1024 * 1024,
});

export interface JavaScriptSurfaceBudgetSample {
    capabilities: {
        heap: boolean;
        longTask: boolean;
    };
    heapGrowthBytes: number | null;
    cpuWindowMillis: number | null;
    domNodes: number;
    timers: number;
}

export interface JavaScriptSurfaceHostKeydown {
    key: string;
    code: string;
    repeat: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}

export interface JavaScriptSurfaceHostDragStart {
    gestureId: number;
    x: number;
    y: number;
    normalizedX: number;
    normalizedY: number;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
}

export interface JavaScriptSurfaceHostDragPointer extends JavaScriptSurfaceHostDragStart {
    pointerId: number;
    button: number;
    buttons: number;
}

export interface JavaScriptSurfaceHostWheel extends JavaScriptSurfaceHostDragStart {
    deltaY: number;
}

export const validateJavaScriptSurfaceHostDragStart = (
    value: unknown,
): value is JavaScriptSurfaceHostDragStart => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<JavaScriptSurfaceHostDragStart>;
    return Number.isSafeInteger(candidate.gestureId)
        && Number(candidate.gestureId) > 0
        && finiteCoordinate(candidate.x)
        && candidate.x >= 0
        && finiteCoordinate(candidate.y)
        && candidate.y >= 0
        && finiteCoordinate(candidate.normalizedX)
        && candidate.normalizedX >= 0
        && candidate.normalizedX <= 1
        && finiteCoordinate(candidate.normalizedY)
        && candidate.normalizedY >= 0
        && candidate.normalizedY <= 1
        && typeof candidate.ctrlKey === "boolean"
        && typeof candidate.altKey === "boolean"
        && typeof candidate.shiftKey === "boolean"
        && typeof candidate.metaKey === "boolean";
};

export const validateJavaScriptSurfaceHostDragPointer = (
    value: unknown,
): value is JavaScriptSurfaceHostDragPointer => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<JavaScriptSurfaceHostDragPointer>;
    return Number.isSafeInteger(candidate.gestureId)
        && Number(candidate.gestureId) > 0
        && finiteCoordinate(candidate.x)
        && finiteCoordinate(candidate.y)
        && finiteCoordinate(candidate.normalizedX)
        && finiteCoordinate(candidate.normalizedY)
        && Number.isInteger(candidate.pointerId)
        && Number(candidate.pointerId) >= 0
        && Number.isInteger(candidate.button)
        && Number(candidate.button) >= -1
        && Number(candidate.button) <= 4
        && Number.isInteger(candidate.buttons)
        && Number(candidate.buttons) >= 0
        && Number(candidate.buttons) <= 31
        && typeof candidate.ctrlKey === "boolean"
        && typeof candidate.altKey === "boolean"
        && typeof candidate.shiftKey === "boolean"
        && typeof candidate.metaKey === "boolean";
};

export const validateJavaScriptSurfaceHostWheel = (
    value: unknown,
): value is JavaScriptSurfaceHostWheel => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<JavaScriptSurfaceHostWheel>;
    return Number.isSafeInteger(candidate.gestureId)
        && Number(candidate.gestureId) > 0
        && finiteCoordinate(candidate.x)
        && candidate.x >= 0
        && finiteCoordinate(candidate.y)
        && candidate.y >= 0
        && finiteCoordinate(candidate.normalizedX)
        && candidate.normalizedX >= 0
        && candidate.normalizedX <= 1
        && finiteCoordinate(candidate.normalizedY)
        && candidate.normalizedY >= 0
        && candidate.normalizedY <= 1
        && finiteCoordinate(candidate.deltaY)
        && Math.abs(candidate.deltaY) <= 100_000
        && typeof candidate.ctrlKey === "boolean"
        && typeof candidate.altKey === "boolean"
        && typeof candidate.shiftKey === "boolean"
        && typeof candidate.metaKey === "boolean";
};

export const validateJavaScriptSurfaceHostKeydown = (
    value: unknown,
): value is JavaScriptSurfaceHostKeydown => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<JavaScriptSurfaceHostKeydown>;
    return typeof candidate.key === "string"
        && candidate.key.length > 0
        && candidate.key.length <= 64
        && typeof candidate.code === "string"
        && candidate.code.length <= 64
        && typeof candidate.repeat === "boolean"
        && typeof candidate.ctrlKey === "boolean"
        && typeof candidate.altKey === "boolean"
        && typeof candidate.shiftKey === "boolean"
        && typeof candidate.metaKey === "boolean";
};

export interface JavaScriptSurfaceEventBudgetWindow {
    windowStartedAt: number;
    count: number;
}

export const consumeJavaScriptSurfaceEventBudget = (
    current: JavaScriptSurfaceEventBudgetWindow,
    now: number,
): { allowed: boolean; window: JavaScriptSurfaceEventBudgetWindow } => {
    const window = now < current.windowStartedAt || now - current.windowStartedAt >= 1_000
        ? { windowStartedAt: now, count: 0 }
        : current;
    const next = { ...window, count: window.count + 1 };
    return {
        allowed: next.count <= JAVASCRIPT_SURFACE_BUDGETS.maxEventsPerSecond,
        window: next,
    };
};

const finiteBudgetMetric = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;

export const javaScriptSurfaceBudgetFailure = (
    sample: JavaScriptSurfaceBudgetSample | undefined,
): string | undefined => {
    if (
        !sample ||
        !sample.capabilities ||
        typeof sample.capabilities.heap !== "boolean" ||
        typeof sample.capabilities.longTask !== "boolean" ||
        !finiteBudgetMetric(sample.domNodes) ||
        !finiteBudgetMetric(sample.timers)
    ) {
        return "JavaScript Surface budget telemetry is unavailable";
    }
    if (
        sample.capabilities.heap
        && !finiteBudgetMetric(sample.heapGrowthBytes)
    ) {
        return "JavaScript Surface heap telemetry is invalid";
    }
    if (
        sample.capabilities.longTask
        && !finiteBudgetMetric(sample.cpuWindowMillis)
    ) {
        return "JavaScript Surface CPU telemetry is invalid";
    }
    if (
        sample.capabilities.heap
        && sample.heapGrowthBytes !== null
        && sample.heapGrowthBytes > JAVASCRIPT_SURFACE_BUDGETS.maxHeapGrowthBytes
    ) {
        return "JavaScript Surface memory budget exceeded";
    }
    if (
        sample.capabilities.longTask
        && sample.cpuWindowMillis !== null
        && sample.cpuWindowMillis > JAVASCRIPT_SURFACE_BUDGETS.maxCpuWindowMillis
    ) {
        return "JavaScript Surface CPU budget exceeded";
    }
    if (sample.domNodes > JAVASCRIPT_SURFACE_BUDGETS.maxDomNodes) {
        return "JavaScript Surface DOM node budget exceeded";
    }
    if (sample.timers > JAVASCRIPT_SURFACE_BUDGETS.maxTimers) {
        return "JavaScript Surface timer budget exceeded";
    }
    return undefined;
};

export const javaScriptSurfaceResourceBudgetFailure = (
    resources: Readonly<Record<string, string>>,
): string | undefined => {
    const entries = Object.entries(resources);
    if (entries.length > JAVASCRIPT_SURFACE_BUDGETS.maxResourceEntries) {
        return "JavaScript Surface resource count budget exceeded";
    }
    let bytes = 0;
    const encoder = new TextEncoder();
    for (const [resourceId, resource] of entries) {
        bytes += encoder.encode(resourceId).byteLength;
        bytes += encoder.encode(resource).byteLength;
        if (bytes > JAVASCRIPT_SURFACE_BUDGETS.maxResourceTransferBytes) {
            return "JavaScript Surface resource memory budget exceeded";
        }
    }
    return undefined;
};

interface Props {
    unitId: string;
    snapshot: SurfaceSnapshot;
    generation: number;
    lifecycle: SurfaceLifecycleState;
    interactive?: boolean;
    displayScale?: number;
    resolveResource: (resourceId: string) => string | undefined;
    onEvent: (event: SurfaceEvent) => void;
    onActivate?: () => void | Promise<void>;
    onDragStart?: (event: MouseEvent) => void;
}

interface ParsedJavaScriptResource {
    base64: string;
    byteLength: number;
}

interface JavaScriptSurfaceEventRequest {
    nodeId?: unknown;
    event?: unknown;
    action?: unknown;
    class?: unknown;
    payload?: unknown;
}

interface JavaScriptSurfaceValidatedEventRequest extends JavaScriptSurfaceEventRequest {
    nodeId: string;
    event: string;
    action: string;
    class: Exclude<SurfaceEventClass, "local">;
}

type RuntimeMessage =
    | { type: "ready"; token: string }
    | { type: "heartbeat"; token: string; budget?: JavaScriptSurfaceBudgetSample }
    | { type: "failure"; token: string; message?: unknown }
    | { type: "host-activate"; token: string }
    | { type: "host-drag-start"; token: string; pointer?: unknown }
    | { type: "host-drag-move"; token: string; pointer?: unknown }
    | { type: "host-drag-end"; token: string; pointer?: unknown }
    | { type: "host-background-double-click"; token: string; pointer?: unknown }
    | { type: "host-wheel"; token: string; wheel?: unknown }
    | { type: "host-keydown"; token: string; keydown?: unknown }
    | { type: "event"; token: string; event?: JavaScriptSurfaceEventRequest };

const base64DecodedLength = (base64: string): number => {
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - padding;
};

export const parseJavaScriptSurfaceDataUrl = (
    dataUrl: string | undefined,
): ParsedJavaScriptResource | undefined => {
    if (!dataUrl) return undefined;
    const match = /^data:application\/javascript;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) return undefined;
    const byteLength = base64DecodedLength(match[1]);
    if (byteLength <= 0 || byteLength > MAX_JAVASCRIPT_SOURCE_BYTES) return undefined;
    return { base64: match[1], byteLength };
};

const findNode = (root: SurfaceNode, nodeId: string): SurfaceNode | undefined => {
    if (root.id === nodeId) return root;
    for (const child of root.children ?? []) {
        const found = findNode(child, nodeId);
        if (found) return found;
    }
    return undefined;
};

export const validateJavaScriptSurfaceEvent = (
    snapshot: SurfaceSnapshot,
    request: JavaScriptSurfaceEventRequest,
): request is JavaScriptSurfaceValidatedEventRequest => {
    if (
        typeof request.nodeId !== "string" ||
        typeof request.event !== "string" ||
        typeof request.action !== "string" ||
        !SAFE_ID.test(request.nodeId) ||
        !SAFE_ID.test(request.event) ||
        !SAFE_ID.test(request.action) ||
        !["discrete", "continuous", "commit"].includes(String(request.class))
    ) {
        return false;
    }
    const node = findNode(snapshot.scene, request.nodeId);
    if (node?.events?.[request.event] !== request.action) return false;
    try {
        return new TextEncoder().encode(JSON.stringify(request.payload ?? null)).byteLength
            <= JAVASCRIPT_SURFACE_BUDGETS.maxEventPayloadBytes;
    } catch {
        return false;
    }
};

const randomIdentity = (prefix: string): string =>
    `${prefix}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

const finiteCoordinate = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

export interface JavaScriptSurfaceFrameGeometry {
    bounds: DOMRect;
    scaleX: number;
    scaleY: number;
    localWidth: number;
    localHeight: number;
}

export interface JavaScriptSurfaceFramePoint {
    x: number;
    y: number;
    normalizedX: number;
    normalizedY: number;
}

/**
 * Resolve coordinates against the browser's final rendered frame. Art views
 * can be transformed by a view scale, crop stage, DPI scaling, or a parent
 * transform; the presentation scale alone does not include all of those.
 */
export const resolveJavaScriptSurfaceFrameGeometry = (
    frame: HTMLIFrameElement,
    fallbackScale = 1,
): JavaScriptSurfaceFrameGeometry => {
    const bounds = frame.getBoundingClientRect();
    const fallback = Number.isFinite(fallbackScale) && fallbackScale > 0 ? fallbackScale : 1;
    const localWidth = frame.clientWidth || frame.offsetWidth || bounds.width / fallback || 1;
    const localHeight = frame.clientHeight || frame.offsetHeight || bounds.height / fallback || 1;
    const measuredScaleX = bounds.width / localWidth;
    const measuredScaleY = bounds.height / localHeight;
    return {
        bounds,
        scaleX: Number.isFinite(measuredScaleX) && measuredScaleX > 0 ? measuredScaleX : fallback,
        scaleY: Number.isFinite(measuredScaleY) && measuredScaleY > 0 ? measuredScaleY : fallback,
        localWidth,
        localHeight,
    };
};

export const resolveJavaScriptSurfaceFramePoint = (
    geometry: JavaScriptSurfaceFrameGeometry,
    clientX: number,
    clientY: number,
): JavaScriptSurfaceFramePoint => {
    const normalizedX = geometry.bounds.width > 0
        ? (clientX - geometry.bounds.left) / geometry.bounds.width
        : (clientX - geometry.bounds.left) / (geometry.localWidth * geometry.scaleX);
    const normalizedY = geometry.bounds.height > 0
        ? (clientY - geometry.bounds.top) / geometry.bounds.height
        : (clientY - geometry.bounds.top) / (geometry.localHeight * geometry.scaleY);
    return {
        x: normalizedX * geometry.localWidth,
        y: normalizedY * geometry.localHeight,
        normalizedX,
        normalizedY,
    };
};

const resolveJavaScriptSurfaceHostClientPoint = (
    geometry: JavaScriptSurfaceFrameGeometry,
    point: Pick<JavaScriptSurfaceHostDragStart, "normalizedX" | "normalizedY">,
) => ({
    x: geometry.bounds.left + point.normalizedX * geometry.bounds.width,
    y: geometry.bounds.top + point.normalizedY * geometry.bounds.height,
});

export const JavaScriptSurface: Component<Props> = (props) => {
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
        if (sendDispose && port) port.postMessage({ type: "dispose", token });
        port?.close();
        port = undefined;
        activeHostDragGestureId = null;
        if (watchdog) clearInterval(watchdog);
        watchdog = undefined;
        setReady(false);
    };

    const handleRuntimeMessage = (message: RuntimeMessage): void => {
        if (!message || message.token !== token) return;
        if (message.type === "host-activate") {
            void Promise.resolve(props.onActivate?.()).finally(() => {
                port?.postMessage({ type: "restore-editable-focus", token });
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
            window.dispatchEvent(new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                key: keydown.key,
                code: keydown.code,
                repeat: keydown.repeat,
                ctrlKey: keydown.ctrlKey,
                altKey: keydown.altKey,
                shiftKey: keydown.shiftKey,
                metaKey: keydown.metaKey,
            }));
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
        port.onmessage = (event: MessageEvent<RuntimeMessage>) => handleRuntimeMessage(event.data);
        port.start();
        lastHeartbeat = Date.now();
        lastWatchdogTick = lastHeartbeat;
        const transferableSnapshot = cloneSurfaceJson(props.snapshot);
        const transferableResources = cloneSurfaceJson(resources);
        iframe.contentWindow.postMessage({
            type: "surface:init",
            token,
            entryBase64: entry.base64,
            snapshot: transferableSnapshot,
            resources: transferableResources,
        }, "*", [channel.port2]);
        port.postMessage({
            type: props.lifecycle === "suspended" || props.lifecycle === "inactive"
                ? "suspend"
                : "resume",
            token,
        });
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
            resources: cloneSurfaceJson(resources),
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
