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
import { DeclarativeSurface } from "./DeclarativeSurface";
import "./JavaScriptSurface.css";

const MAX_JAVASCRIPT_SOURCE_BYTES = 512 * 1024;
const WATCHDOG_MILLIS = 3_000;
const SAFE_ID = /^[A-Za-z0-9._:/-]{1,160}$/;

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
    resolveResource: (resourceId: string) => string | undefined;
    onEvent: (event: SurfaceEvent) => void;
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

export const JavaScriptSurface: Component<Props> = (props) => {
    let iframe: HTMLIFrameElement | undefined;
    let port: MessagePort | undefined;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let lastHeartbeat = 0;
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

    const closeRuntime = (sendDispose: boolean): void => {
        if (sendDispose && port) port.postMessage({ type: "dispose", token });
        port?.close();
        port = undefined;
        if (watchdog) clearInterval(watchdog);
        watchdog = undefined;
        setReady(false);
    };

    const handleRuntimeMessage = (message: RuntimeMessage): void => {
        if (!message || message.token !== token) return;
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
            if (Date.now() - lastHeartbeat <= WATCHDOG_MILLIS) return;
            setRuntimeError("JavaScript Surface exceeded its response budget");
            closeRuntime(false);
            iframe?.remove();
        }, 500);
    };

    createEffect(() => {
        const snapshot = props.snapshot;
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

    onCleanup(() => closeRuntime(true));

    return (
        <div class="javascript-surface-host" data-runtime-error={runtimeError()}>
            <Show when={entryResource()}>
                <iframe
                    ref={iframe}
                    class="javascript-surface-frame"
                    classList={{ "is-ready": ready() }}
                    sandbox="allow-scripts"
                    src={documentUrl}
                    tabindex={props.interactive === false ? -1 : 0}
                    aria-label="Art Surface"
                    onLoad={initializeRuntime}
                    style={{ "pointer-events": props.interactive === false ? "none" : "auto" }}
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
