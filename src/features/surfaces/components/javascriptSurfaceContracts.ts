import type {
    SurfaceEvent,
    SurfaceEventClass,
    SurfaceLifecycleState,
    SurfaceNode,
    SurfaceSnapshot,
} from "../services/surfaceProtocol";

export interface JavaScriptSurfaceProps {
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

export const finiteCoordinate = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

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
    if (sample.capabilities.heap && !finiteBudgetMetric(sample.heapGrowthBytes)) {
        return "JavaScript Surface heap telemetry is invalid";
    }
    if (sample.capabilities.longTask && !finiteBudgetMetric(sample.cpuWindowMillis)) {
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
    for (const [resourceId, resource] of entries) {
        bytes += javaScriptSurfaceUtf8ByteLength(
            resourceId,
            JAVASCRIPT_SURFACE_BUDGETS.maxResourceTransferBytes - bytes,
        );
        bytes += javaScriptSurfaceUtf8ByteLength(
            resource,
            JAVASCRIPT_SURFACE_BUDGETS.maxResourceTransferBytes - bytes,
        );
        if (bytes > JAVASCRIPT_SURFACE_BUDGETS.maxResourceTransferBytes) {
            return "JavaScript Surface resource memory budget exceeded";
        }
    }
    return undefined;
};

// Count UTF-8 bytes without allocating a second resource-sized Uint8Array.
export const javaScriptSurfaceUtf8ByteLength = (value: string, stopAfter = Infinity): number => {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit <= 0x7f) {
            bytes += 1;
        } else if (codeUnit <= 0x7ff) {
            bytes += 2;
        } else if (
            codeUnit >= 0xd800
            && codeUnit <= 0xdbff
            && index + 1 < value.length
            && value.charCodeAt(index + 1) >= 0xdc00
            && value.charCodeAt(index + 1) <= 0xdfff
        ) {
            bytes += 4;
            index += 1;
        } else {
            // BMP code points and unpaired surrogates both encode to three bytes;
            // TextEncoder replaces an unpaired surrogate with U+FFFD.
            bytes += 3;
        }
        if (bytes > stopAfter) return bytes;
    }
    return bytes;
};

interface ParsedJavaScriptResource {
    base64: string;
    byteLength: number;
}

export interface JavaScriptSurfaceEventRequest {
    nodeId?: unknown;
    event?: unknown;
    action?: unknown;
    class?: unknown;
    payload?: unknown;
}

export type JavaScriptSurfaceRuntimeMessage =
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

interface JavaScriptSurfaceValidatedEventRequest extends JavaScriptSurfaceEventRequest {
    nodeId: string;
    event: string;
    action: string;
    class: Exclude<SurfaceEventClass, "local">;
}

const base64DecodedLength = (base64: string): number => {
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.floor((base64.length * 3) / 4) - padding;
};

export const parseJavaScriptSurfaceDataUrl = (
    dataUrl: string | undefined,
): ParsedJavaScriptResource | undefined => {
    if (!dataUrl) return undefined;
    const match = /^data:application\/javascript;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match || match[1].length % 4 === 1) return undefined;
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

export const randomIdentity = (prefix: string): string => {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === "function") {
        return `${prefix}:${cryptoApi.randomUUID()}`;
    }
    if (typeof cryptoApi?.getRandomValues !== "function") {
        throw new Error("Secure JavaScript Surface identity generation is unavailable");
    }
    const entropy = cryptoApi.getRandomValues(new Uint32Array(4));
    return `${prefix}:${Array.from(entropy, (value) => value.toString(16).padStart(8, "0")).join("")}`;
};
