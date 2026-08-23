import { invoke } from "@tauri-apps/api/core";
import {
    HandshakeRequest,
    HandshakeResponse,
    type ArtDelivery,
    type ArtResultCandidateMetadata,
    type DeliveryPayload,
    type HookArtPortValue,
    type HookArtResultCommit,
    type HookResponse,
} from "./protocol";
import { ShaderResponse } from "../components/ShaderRenderer";
import { BootProfile, defaultBootProfile, normalizeBootProfile } from "./bootProfile";
import type { FrozenStickerEntry } from "./stickerSnapshot";
import type {
    SessionSticker,
    SessionLink,
    SessionGroup,
    WorkflowAssetArchiveHints,
    WorkflowAssetArchiveIndex,
} from "../types/unit";
import type {
    CaptureWindowTarget,
    LongCaptureAxis,
    LongCaptureDirection,
    LongCaptureOverlapAnalysis,
} from "./captureState";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../types/appSettings";
import type { FileNamingContext } from "../types/fileNaming";
import { hookSurfaceHostCapabilities } from "./surfaceHostCapabilities";

// Arguments Types
export interface PinRect {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    name: string;
}

export interface CaptureResponse {
    base64: string;
    width: number;
    height: number;
    filePath?: string | null;
    fileUrl?: string | null;
    dynamicRange?: "sdr" | "hdr";
    bitDepth?: 8 | 16;
    colorSpace?: "srgb" | "bt2020-pq";
    captureBackend?: string;
    downgradedFromHdr?: boolean;
}

export interface CaptureRegionOptions {
    compositionOverlayAlpha?: number;
}

export interface OcrResult {
    fullText: string;
    textBlocks?: Array<{
        text: string;
        boxPoints: { x: number; y: number }[];
        boxScore: number;
        textScore: number;
        colorHex: string;
        bgColorHex: string;
        translatedText?: string;
        translating?: boolean;
    }>;
    width?: number;
    height?: number;
    scaleFactor?: number;
}

export interface EnhancementCapabilities {
    ocr: boolean;
    translation: boolean;
}

export interface SessionData {
    documentSchemaVersion: number;
    documentRevision: number;
    stickers: SessionSticker[];
    links: SessionLink[];
    groups?: SessionGroup[];
    recycleBin?: FrozenStickerEntry[];
    referenceLibrary?: FrozenStickerEntry[];
    workflowAssetArchiveIndex?: WorkflowAssetArchiveIndex;
}

export interface SessionSaveResult {
    documentRevision: number;
}

export interface PreciseSelectionResult {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface ScreenColorSample {
    hex: string;
    rgb: { r: number; g: number; b: number };
}

export interface VoiceSettingsSummary {
    shortcut: string;
    triggerMode: string;
    audioBackend: string;
    providerKind: string;
    outputMode: string;
    clipboardBackend: string;
    voiceMode: string;
}

export interface ToolSettingsData {
    stickerToolSettings?: Record<string, unknown> | null;
}

export interface TalkVoiceCaptureRequest {
    requestId?: string;
    mode?: string;
    context?: Record<string, unknown>;
    timeoutMs?: number;
}

export interface TalkInvokeErrorPayload {
    code: string;
    message: string;
}

export interface TalkVoiceCaptureResult {
    requestId: string;
    status: string;
    text?: string | null;
    transcript?: string | null;
    sessionId?: string | null;
    evidencePath?: string | null;
    triggerEvents?: string[];
    error?: TalkInvokeErrorPayload | null;
}

export interface LoomBrainPlanRequest {
    requestId?: string;
    goal: string;
    constraints?: string[];
    context?: Record<string, unknown>;
    timeoutMs?: number;
}

export interface LoomInvokeErrorPayload {
    code: string;
    message: string;
}

export interface LoomBrainPlanResult {
    requestId: string;
    status: string;
    runId?: string | null;
    summary?: string | null;
    steps?: string[];
    run?: Record<string, unknown> | null;
    error?: LoomInvokeErrorPayload | null;
}

export interface TeaHookContext {
    active_window: string | null;
    selection_text: string | null;
    ocr_text: string | null;
    screenshot_ref: string | null;
    cwd: string | null;
    app: string | null;
}

export interface TeaHookAttachment {
    kind: string;
    reference: string;
}

export interface TeaHookIntakeRequest {
    source: string;
    text: string;
    context: TeaHookContext;
    attachments: TeaHookAttachment[];
}

export interface TeaTicketSummary {
    id: string;
    title: string;
    status: string;
    approval_policy?: string | null;
    labels: string[];
}

const EMPTY_HANDSHAKE: HandshakeResponse = {
    protocolVersion: "loom.hook.v1",
    serverName: "browser-preview",
    serverVersion: "0.1.7",
    capabilities: {
        artDefinitions: [],
        surface: hookSurfaceHostCapabilities(),
        operations: [],
    },
    transport: "websocket",
    sessionId: "browser-preview",
};

const warnedMethods = new Set<string>();
const BROWSER_LOOM_HOOK_WS_URL = "ws://127.0.0.1:19820";
const BROWSER_SESSION_STORAGE_KEY = "hook_browser_preview_session";
const BROWSER_WS_REQUEST_TIMEOUT_MS = 20000;
const BROWSER_ART_EXECUTE_TIMEOUT_MS = 150000;
const BROWSER_SESSION_DATA_URL_THRESHOLD = 8 * 1024;
const defaultVoiceSettingsSummary: VoiceSettingsSummary = {
    shortcut: "Ctrl+Alt+Space",
    triggerMode: "toggle",
    audioBackend: "silent",
    providerKind: "mock",
    outputMode: "dry_run",
    clipboardBackend: "fallback",
    voiceMode: "dictate",
};
type BrowserPushHandler = (payload: unknown) => void;
const browserPushHandlers = new Map<string, Set<BrowserPushHandler>>();
let browserPushSocket: WebSocket | null = null;
let browserPushReconnectTimer: number | null = null;

const warnBrowserFallback = (method: string) => {
    if (warnedMethods.has(method)) return;
    warnedMethods.add(method);
    console.warn(`[API] ${method} skipped: Tauri runtime unavailable (browser preview mode)`);
};

// Type guard for Tauri runtime availability
interface WindowWithTauri extends Window {
    __TAURI_INTERNALS__?: unknown;
}

export const isTauriRuntimeAvailable = () =>
    typeof window !== "undefined" && typeof (window as WindowWithTauri).__TAURI_INTERNALS__ !== "undefined";

const safeInvoke = async <T>(
    command: string,
    args: Record<string, unknown> | undefined,
    fallback?: () => T | Promise<T>,
    warnOnFallback: boolean = true,
): Promise<T> => {
    if (!isTauriRuntimeAvailable()) {
        if (fallback) {
            if (warnOnFallback) {
                warnBrowserFallback(command);
            }
            return await fallback();
        }
        throw new Error(`Tauri runtime unavailable for command: ${command}`);
    }

    return invoke(command, args);
};

const requestIdFromParams = (params: unknown): string | undefined => {
    if (!params || typeof params !== "object" || !("requestId" in params)) return undefined;
    return typeof params.requestId === "string" ? params.requestId : undefined;
};

const browserLoomHookRequest = async <T = unknown>(
    request: { method: string; params?: unknown },
    options?: { timeoutMs?: number },
): Promise<T> => {
    if (typeof WebSocket === "undefined") {
        throw new Error("WebSocket unavailable in current browser environment");
    }

    const expectedRequestId = requestIdFromParams(request.params);
    const timeoutMs = options?.timeoutMs ?? BROWSER_WS_REQUEST_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
        const ws = new WebSocket(BROWSER_LOOM_HOOK_WS_URL);
        let settled = false;

        const timeout = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            ws.close();
            reject(new Error(`Loom Hook WebSocket request timed out: ${request.method}`));
        }, timeoutMs);

        ws.onerror = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error(`Loom Hook WebSocket connection failed: ${request.method}`));
        };

        ws.onopen = () => {
            ws.send(JSON.stringify(request));
        };

        ws.onclose = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error(`Loom Hook WebSocket closed before response: ${request.method}`));
        };

        ws.onmessage = (event) => {
            try {
                const parsed = JSON.parse(String(event.data));
                if (!parsed || typeof parsed !== "object") {
                    return;
                }
                const isHandshake = request.method === "loom.hook.handshake" &&
                    parsed.protocolVersion === "loom.hook.v1" &&
                    typeof parsed.sessionId === "string" &&
                    typeof parsed.serverName === "string";
                const isRequestResponse = expectedRequestId !== undefined &&
                    parsed.protocolVersion === "loom.hook.v1" &&
                    parsed.requestId === expectedRequestId &&
                    typeof parsed.status === "string";
                const isHookResponse = isHandshake || isRequestResponse;
                if (!isHookResponse) {
                    return;
                }

                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                ws.close();
                resolve(parsed as T);
            } catch (error) {
                reject(error);
            }
        };
    });
};

const loomHookRequest = async <T = unknown>(method: string, params?: unknown): Promise<T> => {
    interface ErrorResponse {
        type?: string;
        data?: { message?: string } & T;
        message?: string;
    }

    const response = await browserLoomHookRequest<ErrorResponse>({
        method,
        params,
    });

    const responseRecord = response as ErrorResponse & { status?: string; error?: { message?: string } };
    if (response?.type === "error" || responseRecord.status === "failed") {
        const errorMessage =
            (response.data && typeof response.data === "object" && "message" in response.data
                ? response.data.message
                : undefined) ||
            response.message ||
            responseRecord.error?.message ||
            `Loom Hook IPC request failed: ${method}`;
        throw new Error(errorMessage);
    }

    return (response?.data ?? response) as T;
};

const scheduleBrowserPushReconnect = () => {
    if (browserPushReconnectTimer !== null || browserPushHandlers.size === 0) return;

    browserPushReconnectTimer = window.setTimeout(() => {
        browserPushReconnectTimer = null;
        ensureBrowserPushSocket();
    }, 1000);
};

const ensureBrowserPushSocket = () => {
    if (typeof WebSocket === "undefined") return;
    if (browserPushSocket && browserPushSocket.readyState !== WebSocket.CLOSED) return;
    if (browserPushHandlers.size === 0) return;

    browserPushSocket = new WebSocket(BROWSER_LOOM_HOOK_WS_URL);

    browserPushSocket.onopen = () => {
        try {
            const events = Array.from(browserPushHandlers.keys());
            browserPushSocket?.send(JSON.stringify({
                method: "loom.hook.subscribe",
                params: {
                    requestId: `subscribe:${crypto.randomUUID()}`,
                    events,
                },
            }));
        } catch (error) {
            console.error("[API] Failed to subscribe browser push socket:", error);
        }
    };

    browserPushSocket.onmessage = (event) => {
        try {
            const parsed = JSON.parse(String(event.data));
            if (parsed?.protocolVersion !== "loom.hook.v1") return;
            const method = typeof parsed?.method === "string" ? parsed.method : null;
            if (!method) return;

            const handlers = browserPushHandlers.get(method);
            if (!handlers || handlers.size === 0) return;

            handlers.forEach((handler) => {
                try {
                    handler(parsed.params);
                } catch (error) {
                    console.error(`[API] Browser push handler failed for ${method}:`, error);
                }
            });
        } catch (error) {
            console.error("[API] Failed to parse browser push message:", error);
        }
    };

    browserPushSocket.onclose = () => {
        browserPushSocket = null;
        scheduleBrowserPushReconnect();
    };

    browserPushSocket.onerror = () => {
        browserPushSocket?.close();
    };
};

const stopBrowserPushSocketIfUnused = () => {
    if (browserPushHandlers.size > 0) return;
    if (browserPushReconnectTimer !== null) {
        window.clearTimeout(browserPushReconnectTimer);
        browserPushReconnectTimer = null;
    }
    browserPushSocket?.close();
    browserPushSocket = null;
};

const browserHandshakeFallback = async (): Promise<HandshakeResponse> => {
    try {
        return await browserLoomHookRequest<HandshakeResponse>({
            method: "loom.hook.handshake",
            params: {
                protocolVersion: "loom.hook.v1",
                supportedProtocolVersions: ["loom.hook.v1"],
                clientId: "hook.browser-preview",
                clientVersion: "0.1.7",
                platform: "browser-preview",
                transports: ["websocket"],
                surface: hookSurfaceHostCapabilities(),
            },
        });
    } catch (error) {
        console.warn("[API] browserLoom Hook handshake fallback failed:", error);
        return EMPTY_HANDSHAKE;
    }
};

const browserInlineResource = (source: string): HookArtPortValue => {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(source);
    if (!match) {
        throw new Error("Browser Art execution requires data URL image inputs");
    }
    return {
        kind: "inline_resource",
        mime: match[1],
        dataBase64: match[2],
    };
};

const PREFERRED_HOOK_ART_OUTPUT_NAMES = ["output_image", "output", "image"] as const;

const preferredHookArtOutput = (
    outputs: Record<string, HookArtPortValue>,
): [string, HookArtPortValue] | undefined => {
    for (const name of PREFERRED_HOOK_ART_OUTPUT_NAMES) {
        const value = outputs[name];
        if (value) {
            return [name, value];
        }
    }
    return Object.entries(outputs)[0];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const requireNonEmptyString = (value: unknown, field: string): string => {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Loom Hook formal value is missing ${field}`);
    }
    return value;
};

const requirePositiveInteger = (value: unknown, field: string): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`Loom Hook formal value has invalid ${field}`);
    }
    return value;
};

const validateBareBase64 = (value: string): void => {
    if (value.startsWith("data:") || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        throw new Error("Loom Hook inline formal value has invalid bare dataBase64");
    }
};

const validateBrowserPortValue = (value: unknown): HookArtPortValue => {
    if (!isRecord(value)) {
        throw new Error("Loom Hook formal output must be an object");
    }
    switch (value.kind) {
        case "value":
            if (!("value" in value)) {
                throw new Error("Loom Hook value formal output is missing value");
            }
            return { kind: "value", value: value.value };
        case "inline_resource": {
            const mime = requireNonEmptyString(value.mime, "mime");
            const dataBase64 = requireNonEmptyString(value.dataBase64, "dataBase64");
            validateBareBase64(dataBase64);
            const width = value.width === undefined
                ? undefined
                : requirePositiveInteger(value.width, "width");
            const height = value.height === undefined
                ? undefined
                : requirePositiveInteger(value.height, "height");
            return { kind: "inline_resource", mime, dataBase64, width, height };
        }
        case "shared_memory": {
            if (value.format !== "rgba8") {
                throw new Error("Loom Hook shared-memory formal output must use rgba8");
            }
            const handle = requireNonEmptyString(value.handle, "handle");
            if (!handle.startsWith("Loom_Buffer_")) {
                throw new Error("Loom Hook shared-memory formal output has an invalid handle");
            }
            return {
                kind: "shared_memory",
                handle,
                size: requirePositiveInteger(value.size, "size"),
                width: requirePositiveInteger(value.width, "width"),
                height: requirePositiveInteger(value.height, "height"),
                format: "rgba8",
            };
        }
        case "resource":
            if (!isRecord(value.resource)) {
                throw new Error("Loom Hook broker resource formal output is missing resource");
            }
            return { kind: "resource", resource: value.resource };
        default:
            throw new Error("Loom Hook formal output has an unsupported kind");
    }
};

const browserPortValueToOutput = (untrustedValue: unknown): unknown => {
    const value = validateBrowserPortValue(untrustedValue);
    switch (value.kind) {
        case "inline_resource":
            return `data:${value.mime};base64,${value.dataBase64}`;
        case "value":
            return value.value;
        case "shared_memory":
            throw new Error("Browser Art execution cannot read Loom shared-memory outputs");
        case "resource":
            throw new Error("Browser Art execution cannot read broker resource outputs");
    }
};

const browserPortValueDelivery = (untrustedValue: unknown): DeliveryPayload => {
    const value = validateBrowserPortValue(untrustedValue);
    switch (value.kind) {
        case "inline_resource":
            return {
                type: "base64",
                data: `data:${value.mime};base64,${value.dataBase64}`,
                width: value.width,
                height: value.height,
            };
        case "shared_memory":
            throw new Error("Browser Art execution cannot read Loom shared-memory outputs");
        case "value": {
            const record = value.value && typeof value.value === "object"
                ? value.value as Record<string, unknown>
                : undefined;
            const candidates = record?.loomMetadata && typeof record.loomMetadata === "object"
                ? (record.loomMetadata as Record<string, unknown>).candidates
                : undefined;
            return {
                type: "value",
                value: value.value,
                ...(candidates && typeof candidates === "object"
                    ? { candidates: candidates as ArtResultCandidateMetadata }
                    : {}),
            };
        }
        case "resource":
            throw new Error("Browser Art execution cannot read broker resource outputs");
    }
};

const browserDispatchActionFallback = async (actionEnum: { action: string; payload: unknown }): Promise<void> => {
    const payload = actionEnum.payload && typeof actionEnum.payload === "object"
        ? actionEnum.payload as Record<string, unknown>
        : {};
    try {
        switch (actionEnum.action) {
            case "sync_workflow":
                await browserLoomHookRequest({
                    method: "loom.hook.workflow.sync",
                    params: {
                        requestId: `workflow-sync:${crypto.randomUUID()}`,
                        workflowId: payload.workflow_id,
                        snapshot: payload.snapshot,
                    },
                });
                return;
            case "update_workflow_node":
                await browserLoomHookRequest({
                    method: "loom.hook.workflow.node.update",
                    params: {
                        requestId: payload.request_id,
                        workflowId: payload.workflow_id,
                        nodeId: payload.node_id,
                        parameterId: payload.parameter_id,
                        value: payload.value,
                    },
                });
                return;
            case "cancel_art":
                {
                const response = await browserLoomHookRequest<HookResponse>({
                    method: "loom.hook.art.cancel",
                    params: {
                        protocolVersion: "loom.hook.v1",
                        requestId: payload.request_id,
                        nodeId: payload.node_id,
                        generation: payload.generation,
                        deviceId: "device:browser-preview",
                    },
                }, { timeoutMs: 5_000 });
                if (
                    response.status === "failed"
                    && response.error?.code !== "request_not_found"
                ) {
                    throw new Error(response.error?.message ?? `Art cancel ${response.status}`);
                }
                return;
                }
            case "execute_art":
                {
                const response = await browserLoomHookRequest<HookResponse<HookArtResultCommit>>({
                    method: "loom.hook.art.execute",
                    params: {
                        protocolVersion: "loom.hook.v1",
                        requestId: payload.request_id,
                        nodeId: payload.node_id,
                        artId: payload.art_id,
                        generation: payload.generation,
                        deviceId: "device:browser-preview",
                        outputTransports: ["websocket"],
                        inputs: Object.fromEntries(
                            Object.entries((payload.inputs as Record<string, string> | undefined) ?? {})
                                .map(([name, value]): [string, HookArtPortValue] => [
                                    name,
                                    browserInlineResource(value),
                                ]),
                        ),
                        parameters: payload.parameters ?? {},
                        disabledParameters: payload.disabled_parameters ?? [],
                    },
                }, { timeoutMs: BROWSER_ART_EXECUTE_TIMEOUT_MS });
                if (response.status !== "succeeded") {
                    throw new Error(response.error?.message ?? `Art execution ${response.status}`);
                }
                if (
                    response.data.protocolVersion !== "loom.hook.v1"
                    || response.data.requestId !== payload.request_id
                    || response.data.nodeId !== payload.node_id
                    || response.data.generation !== payload.generation
                    || !Number.isSafeInteger(response.data.resultRevision)
                    || response.data.resultRevision < 1
                    || !isRecord(response.data.outputs)
                ) {
                    throw new Error("Loom Hook Art execution returned an invalid result commit");
                }
                const outputs = response.data.outputs;
                const primary = preferredHookArtOutput(outputs);
                if (!primary) {
                    throw new Error("Loom Hook Art execution returned no output");
                }
                const decodedOutputs = Object.fromEntries(
                    Object.entries(outputs).map(([name, portValue]) => [
                        name,
                        browserPortValueToOutput(portValue),
                    ]),
                );
                if (typeof payload.node_id !== "string" || typeof payload.request_id !== "string") {
                    throw new Error("Browser Art execution requires string node_id and request_id");
                }
                window.dispatchEvent(new CustomEvent("hook-browser-art-ready", {
                    detail: {
                        art_id: payload.node_id,
                        request_id: payload.request_id,
                        generation: response.data.generation,
                        result_revision: response.data.resultRevision,
                        phase: "final",
                        status: 200,
                        delivery: {
                            ...browserPortValueDelivery(primary[1]),
                            outputs: decodedOutputs,
                            ...(response.data.candidates
                                ? { candidates: response.data.candidates }
                                : {}),
                        },
                    } satisfies ArtDelivery,
                }));
                return;
                }
            default:
                warnBrowserFallback(`dispatch:${actionEnum.action}`);
                return;
        }
    } catch (error) {
        if (actionEnum.action === "execute_art") {
            const nodeId = payload.node_id;
            const requestId = payload.request_id;
            const message = error instanceof Error ? error.message : String(error);
            if (typeof nodeId === "string" && typeof requestId === "string") {
                window.dispatchEvent(new CustomEvent("hook-browser-art-ready", {
                    detail: {
                        art_id: nodeId,
                        request_id: requestId,
                        status: 500,
                        error: message,
                        delivery: { type: "base64" },
                    } satisfies ArtDelivery,
                }));
            }
            return;
        }
        console.warn(`[API] browser dispatch fallback failed for ${actionEnum.action}:`, error);
    }
};

const loadBrowserPreviewSession = (): SessionData => {
    try {
        const raw = window.localStorage.getItem(BROWSER_SESSION_STORAGE_KEY);
        if (!raw) {
            return { documentSchemaVersion: 1, documentRevision: 0, stickers: [], links: [], groups: [], recycleBin: [], referenceLibrary: [] };
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.stickers) && Array.isArray(parsed?.links)) {
            const hasSchema = parsed?.documentSchemaVersion !== undefined;
            const hasRevision = parsed?.documentRevision !== undefined;
            if (
                hasSchema
                && (parsed.documentSchemaVersion !== 1
                    || !Number.isSafeInteger(parsed.documentRevision)
                    || parsed.documentRevision < 0)
            ) {
                throw new Error(
                    `SESSION_SCHEMA_UNSUPPORTED browser session schema ${String(parsed.documentSchemaVersion)} is not supported`,
                );
            }
            if (!hasSchema && hasRevision) {
                throw new Error("SESSION_SCHEMA_INVALID documentRevision requires documentSchemaVersion");
            }
            return {
                documentSchemaVersion: 1,
                documentRevision: hasSchema ? parsed.documentRevision : 0,
                stickers: parsed.stickers,
                links: parsed.links,
                groups: Array.isArray(parsed?.groups) ? parsed.groups : [],
                recycleBin: Array.isArray(parsed?.recycleBin) ? parsed.recycleBin : [],
                referenceLibrary: Array.isArray(parsed?.referenceLibrary) ? parsed.referenceLibrary : [],
                workflowAssetArchiveIndex:
                    parsed?.workflowAssetArchiveIndex && typeof parsed.workflowAssetArchiveIndex === "object"
                        ? parsed.workflowAssetArchiveIndex
                        : undefined,
            } as SessionData;
        }
    } catch (error) {
        if (String(error).includes("SESSION_SCHEMA_")) throw error;
        console.warn("[API] Failed to parse browser preview session:", error);
    }

    return { documentSchemaVersion: 1, documentRevision: 0, stickers: [], links: [], groups: [], recycleBin: [], referenceLibrary: [] };
};

const trimBrowserSessionValue = (
    value: string | null | undefined,
): string | null | undefined => {
    if (typeof value === "string" && value.startsWith("data:") && value.length > BROWSER_SESSION_DATA_URL_THRESHOLD) {
        return null;
    }
    return value;
};

const compactBrowserPreviewSession = (
    stickers: SessionSticker[],
    links: SessionLink[],
    groups: SessionGroup[] = [],
    recycleBin: FrozenStickerEntry[] = [],
    referenceLibrary: FrozenStickerEntry[] = [],
    workflowAssetArchiveIndex?: WorkflowAssetArchiveIndex,
    documentRevision = 0,
): SessionData => ({
    documentSchemaVersion: 1,
    documentRevision,
    stickers: stickers.map((sticker) => ({
        ...sticker,
        src: trimBrowserSessionValue(sticker?.src),
        previewSrc: trimBrowserSessionValue(sticker?.previewSrc),
        rasterizedAnnotationLayerSrc: trimBrowserSessionValue(sticker?.rasterizedAnnotationLayerSrc),
    })),
    links,
    groups,
    recycleBin,
    referenceLibrary,
    workflowAssetArchiveIndex,
});

const saveBrowserPreviewSession = (
    stickers: SessionSticker[],
    links: SessionLink[],
    groups: SessionGroup[] = [],
    recycleBin: FrozenStickerEntry[] = [],
    referenceLibrary: FrozenStickerEntry[] = [],
    workflowAssetArchiveIndex?: WorkflowAssetArchiveIndex,
    expectedDocumentRevision?: number,
): SessionSaveResult => {
    const current = loadBrowserPreviewSession();
    if (
        expectedDocumentRevision !== undefined
        && expectedDocumentRevision !== current.documentRevision
    ) {
        throw new Error(
            `SESSION_REVISION_CONFLICT expected ${expectedDocumentRevision}, current ${current.documentRevision}; refresh the Hook session before retrying`,
        );
    }
    const documentRevision = current.documentRevision + 1;
    try {
        window.localStorage.setItem(
            BROWSER_SESSION_STORAGE_KEY,
            JSON.stringify({
                documentSchemaVersion: 1,
                documentRevision,
                stickers,
                links,
                groups,
                recycleBin,
                referenceLibrary,
                workflowAssetArchiveIndex,
            }),
        );
    } catch {
        try {
            const compact = compactBrowserPreviewSession(
                stickers,
                links,
                groups,
                recycleBin,
                referenceLibrary,
                workflowAssetArchiveIndex,
                documentRevision,
            );
            window.localStorage.setItem(
                BROWSER_SESSION_STORAGE_KEY,
                JSON.stringify(compact),
            );
        } catch (compactError) {
            console.warn("[API] Failed to save browser preview session:", compactError);
        }
    }
    return { documentRevision };
};

/**
 * Typed API Layer for Backend Communication
 * All raw `invoke` calls should be routed through here.
 */
export const api = {
    getBootProfile: (): Promise<BootProfile> =>
        safeInvoke("get_boot_profile", undefined, () => defaultBootProfile, false).then(normalizeBootProfile),

    getVoiceSettingsSummary: (): Promise<VoiceSettingsSummary> =>
        safeInvoke("get_voice_settings_summary", undefined, () => defaultVoiceSettingsSummary, false),

    captureTalkVoiceOnce: (request: TalkVoiceCaptureRequest = {}): Promise<TalkVoiceCaptureResult> =>
        safeInvoke("talk_capture_voice_once", { request }, () => {
            throw new Error("Talk voice capture requires the Tauri desktop runtime");
        }, false),

    invokeLoomBrainPlan: (request: LoomBrainPlanRequest): Promise<LoomBrainPlanResult> =>
        safeInvoke("loom_brain_plan", { request }, () => {
            throw new Error("Loom brain planning requires the Tauri desktop runtime");
        }, false),

    createTeaTicket: (request: TeaHookIntakeRequest): Promise<TeaTicketSummary> =>
        safeInvoke(
            "create_tea_ticket",
            { request },
            () => {
                throw new Error("Tea ticket creation requires the Tauri desktop runtime");
            },
            false,
        ),

    // --- Loom Hook Protocol ---
    handshake: (request: HandshakeRequest): Promise<HandshakeResponse> =>
        safeInvoke("loom_hook_handshake", { request }, browserHandshakeFallback, false),

    dispatchAction: (actionEnum: { action: string; payload: unknown }): Promise<void> =>
        safeInvoke(
            "loom_hook_dispatch_action",
            { action: actionEnum },
            () => browserDispatchActionFallback(actionEnum),
            false,
        ),

    // --- Session Management ---
    loadSession: (): Promise<SessionData> =>
        safeInvoke("load_session", undefined, loadBrowserPreviewSession, false),

    saveSession: (
        stickers: any[],
        links: any[],
        groups: any[] = [],
        recycleBin: FrozenStickerEntry[] = [],
        referenceLibrary: FrozenStickerEntry[] = [],
        workflowAssetArchiveHints: WorkflowAssetArchiveHints = { workflows: {} },
        expectedDocumentRevision?: number,
    ): Promise<SessionSaveResult> =>
        safeInvoke(
            "save_session",
            {
                stickers,
                links,
                groups,
                recycleBin,
                referenceLibrary,
                workflowAssetArchiveHints,
                expectedDocumentRevision,
            },
            () =>
                saveBrowserPreviewSession(
                    stickers,
                    links,
                    groups,
                    recycleBin,
                    referenceLibrary,
                    undefined,
                    expectedDocumentRevision,
                ),
            false,
        ),

    // --- Color + Screenshot History ---
    loadHistory: (): Promise<{ colors: unknown[]; screenshots: unknown[] }> =>
        safeInvoke("load_history", undefined, () => ({ colors: [], screenshots: [] }), false),

    saveHistory: (colors: unknown[], screenshots: unknown[]): Promise<void> =>
        safeInvoke("save_history", { colors, screenshots }, () => undefined, false),

    loadToolSettings: (): Promise<ToolSettingsData> =>
        safeInvoke("load_tool_settings", undefined, () => ({ stickerToolSettings: null }), false),

    saveToolSettings: (stickerToolSettings: Record<string, unknown>): Promise<void> =>
        safeInvoke("save_tool_settings", { stickerToolSettings }, () => undefined, false),

    loadAppSettings: (): Promise<AppSettings> =>
        safeInvoke(
            "load_app_settings",
            undefined,
            () => ({ ...DEFAULT_APP_SETTINGS, fileNaming: { ...DEFAULT_APP_SETTINGS.fileNaming } }),
            false,
        ),

    saveAppSettings: (settings: AppSettings): Promise<AppSettings> =>
        safeInvoke("save_app_settings", { settings }, () => settings, false),

    getLoomShortcutSettings: (): Promise<unknown | null> =>
        safeInvoke("get_loom_shortcut_settings", undefined, () => null, false),

    getInstalledFonts: (): Promise<string[]> =>
        safeInvoke("get_installed_fonts", undefined, () => [], false),

    hasForegroundWindow: (): Promise<boolean> =>
        safeInvoke("hook_has_foreground_window", undefined, () => true, false),

    // --- UI / Overlay ---
    updatePinRects: (rects: PinRect[]): Promise<void> =>
        safeInvoke("update_pin_rects", { rects }, () => undefined, false),

    initializeOverlay: (): Promise<void> =>
        safeInvoke("initialize_overlay", undefined, () => undefined, false),

    showOverlayHost: (clickThrough = true): Promise<void> =>
        safeInvoke("show_overlay_host", { clickThrough }, () => undefined, false),

    setOverlayClickThrough: (clickThrough: boolean): Promise<void> =>
        safeInvoke("set_overlay_click_through", { clickThrough }, () => undefined, false),

    setNativeStickerDragPreflight: (active: boolean): Promise<void> =>
        safeInvoke("set_native_drag_preflight_active", { active }, () => undefined, false),

    setOverlayKeyboardCaptureActive: (active: boolean): Promise<void> =>
        safeInvoke("set_overlay_keyboard_capture_active", { active }, () => undefined, false),

    focusOverlayWindow: (): Promise<void> =>
        safeInvoke("focus_overlay_window", undefined, () => undefined, false),

    setOverlayCaptureExclusion: (enabled: boolean): Promise<void> =>
        safeInvoke("set_overlay_capture_exclusion", { enabled }, () => undefined, false),

    showCanvasWindow: (): Promise<void> =>
        safeInvoke("show_canvas_window", undefined, () => undefined, false),

    hideToTray: (): Promise<void> =>
        safeInvoke("hide_to_tray", undefined, () => undefined, false),

    triggerCaptureMode: (): Promise<void> =>
        safeInvoke("trigger_capture_mode", undefined, () => undefined, false),

    setCaptureInputActive: (active: boolean): Promise<void> =>
        safeInvoke("set_capture_input_active", { active }, () => undefined, false),

    setDesktopColorPickerActive: (active: boolean): Promise<void> =>
        safeInvoke("set_desktop_color_picker_active", { active }, () => undefined, false),

    debugLogEvent: (event: string, detail?: string): Promise<void> =>
        safeInvoke("append_runtime_log", { event, detail }, () => undefined, false),

    setMouseMonitorActive: (active: boolean): Promise<void> =>
        safeInvoke("set_mouse_monitor_active", { active }, () => undefined, false),

    // --- Shader ---
    prefetchShader: (args: { artId: string, inputPath: string | null, referencePath: string | null }): Promise<ShaderResponse> =>
        safeInvoke("prefetch_shader", args, () => ({
            type: "unsupported",
            success: false,
        }), false),

    getEnhancementCapabilities: (): Promise<EnhancementCapabilities> =>
        loomHookRequest<EnhancementCapabilities>("loom.hook.enhancements.get", {
            requestId: `enhancements:${crypto.randomUUID()}`,
        }).catch(() => ({
            ocr: false,
            translation: false,
        })),

    // --- OCR & Capture ---
    performOcr: (imageBase64: string): Promise<OcrResult> =>
        loomHookRequest("loom.hook.ocr.execute", {
            requestId: `ocr:${crypto.randomUUID()}`,
            imageBase64,
        }),

    translateText: (text: string, targetLang: string): Promise<string> =>
        loomHookRequest<{ translatedText: string }>("loom.hook.translation.execute", {
            requestId: `translation:${crypto.randomUUID()}`,
            text,
            targetLanguage: targetLang,
        }).then((result) => result.translatedText),

    triggerOcrEvent: (): Promise<void> =>
        safeInvoke("trigger_ocr_event", undefined, () => undefined, false),

    captureRegion: (
        x: number,
        y: number,
        w: number,
        h: number,
        options?: CaptureRegionOptions,
    ): Promise<CaptureResponse> => {
        console.log("[API] captureRegion called with:", { x, y, w, h, options });
        return safeInvoke("capture_region", {
            x,
            y,
            w,
            h,
            compositionOverlayAlpha: options?.compositionOverlayAlpha,
        });
    },
    listCaptureWindowTargets: (): Promise<CaptureWindowTarget[]> =>
        safeInvoke("list_capture_window_targets", undefined, () => [], false),
    getCaptureCursorPosition: (): Promise<{ x: number; y: number }> =>
        safeInvoke("get_capture_cursor_position", undefined, () => ({ x: 0, y: 0 }), false),
    captureVerticalLongRegion: (
        x: number,
        y: number,
        w: number,
        h: number,
        options?: {
            maxFrames?: number;
            scrollDelta?: number;
            settleMs?: number;
            overlapScan?: number;
        },
    ): Promise<CaptureResponse> =>
        safeInvoke("capture_vertical_long_region", {
            x,
            y,
            w,
            h,
            maxFrames: options?.maxFrames,
            scrollDelta: options?.scrollDelta,
            settleMs: options?.settleMs,
            overlapScan: options?.overlapScan,
        }),
    stitchVerticalLongCaptureFrames: (
        frames: string[],
        options?: {
            overlapScan?: number;
        },
    ): Promise<CaptureResponse> =>
        safeInvoke("stitch_vertical_long_capture_frames", {
            frames,
            overlapScan: options?.overlapScan,
        }),
    analyzeLongCapturePair: (
        previous: string,
        current: string,
        options?: {
            axis?: LongCaptureAxis;
            direction?: LongCaptureDirection;
            maxScan?: number;
            minOverlapPx?: number;
            minNewContentPx?: number;
        },
    ): Promise<LongCaptureOverlapAnalysis> =>
        safeInvoke("analyze_long_capture_pair", {
            previous,
            current,
            axis: options?.axis,
            direction: options?.direction,
            maxScan: options?.maxScan,
            minOverlapPx: options?.minOverlapPx,
            minNewContentPx: options?.minNewContentPx,
        }),
    stitchLongCaptureFrames: (
        frames: string[],
        options?: {
            axis?: LongCaptureAxis;
            direction?: LongCaptureDirection;
            maxScan?: number;
            minOverlapPx?: number;
        },
    ): Promise<CaptureResponse> =>
        safeInvoke("stitch_long_capture_frames", {
            frames,
            axis: options?.axis,
            direction: options?.direction,
            maxScan: options?.maxScan,
            minOverlapPx: options?.minOverlapPx,
        }),
    startLongCaptureSession: (
        rect: { x: number; y: number; w: number; h: number },
        axis?: LongCaptureAxis,
    ): Promise<string> =>
        safeInvoke("start_long_capture_session", { rect, axis }),
    sampleLongCaptureSession: (sessionId: string): Promise<{
        status: "recorded" | "duplicate";
        frameCount: number;
        duplicateCount: number;
        recorded: boolean;
        axis?: LongCaptureAxis | null;
        direction?: LongCaptureDirection | null;
    }> =>
        safeInvoke("sample_long_capture_session", { sessionId }),
    finishLongCaptureSession: (sessionId: string): Promise<CaptureResponse> =>
        safeInvoke("finish_long_capture_session", { sessionId }),
    cancelLongCaptureSession: (sessionId: string): Promise<void> =>
        safeInvoke("cancel_long_capture_session", { sessionId }),


    getPreciseSelection: (x: number, y: number, w: number, h: number): Promise<PreciseSelectionResult | null> =>
        safeInvoke("get_precise_selection", { x, y, w, h }),

    readSharedMemory: (handle: string, size: number, width: number, height: number): Promise<string> =>
        safeInvoke("read_shared_memory", { handle, size, width, height }),
    releaseArtSharedMemory: (
        nodeId: string,
        executionRequestId: string,
        generation: number,
        handles: string[],
    ): Promise<void> => safeInvoke(
        "release_art_shared_memory",
        { nodeId, executionRequestId, generation, handles },
        () => undefined,
        false,
    ),

    // --- System ---
    getCursorPosition: (): Promise<{x: number, y: number}> =>
        safeInvoke("get_cursor_position", undefined, () => ({ x: 0, y: 0 }), false),
    pickScreenColorAt: (x: number, y: number): Promise<ScreenColorSample> =>
        safeInvoke("pick_screen_color_at", { x, y }, () => ({
            hex: "#000000",
            rgb: { r: 0, g: 0, b: 0 },
        }), false),
    pickScreenColorAtCursor: (): Promise<ScreenColorSample> =>
        safeInvoke("pick_screen_color_at_cursor", undefined, () => ({
            hex: "#000000",
            rgb: { r: 0, g: 0, b: 0 },
        }), false),

    // --- File IO ---
    readImageFromPath: (path: string): Promise<string> =>
        safeInvoke("read_image_from_path", { path }),
    cacheRemoteImageAsset: (url: string, referer?: string): Promise<string> =>
        safeInvoke("cache_remote_image_asset", { url, referer }),

    beginStickerNativeFileDrag: (
        base64: string,
        fileNamingContext?: FileNamingContext,
    ): Promise<string> =>
        safeInvoke(
            "begin_sticker_native_file_drag",
            { base64Image: base64, fileNamingContext },
            () => {
                throw new Error("Native sticker file drag requires the Tauri desktop runtime");
            },
            false,
        ),

    beginStickerNativeFileDragFromPath: (
        path: string,
        fileNamingContext?: FileNamingContext,
    ): Promise<string> =>
        safeInvoke(
            "begin_sticker_native_file_drag_from_path",
            { path, fileNamingContext },
            () => {
                throw new Error("Native sticker file drag from path requires the Tauri desktop runtime");
            },
            false,
        ),

    saveStickerDragExport: (
        base64: string,
        fileNamingContext: FileNamingContext | undefined,
        globalX: number,
        globalY: number,
    ): Promise<string> =>
        safeInvoke(
            "save_sticker_drag_export",
            { base64Image: base64, fileNamingContext, globalX, globalY },
            () => {
                throw new Error("Shift drag export requires the Tauri desktop runtime");
            },
            false,
        ),

    saveStickerDragExportFromPath: (
        path: string,
        fileNamingContext: FileNamingContext | undefined,
        globalX: number,
        globalY: number,
    ): Promise<string> =>
        safeInvoke(
            "save_sticker_drag_export_from_path",
            { path, fileNamingContext, globalX, globalY },
            () => {
                throw new Error("Shift drag export from path requires the Tauri desktop runtime");
            },
            false,
        ),

    saveStickerImage: (base64: string, fileNamingContext?: FileNamingContext): Promise<string> =>
        safeInvoke("save_sticker_image", { base64Image: base64, fileNamingContext }),
    saveStickerImageAs: (
        base64: string,
        dialogCenterX: number,
        dialogCenterY: number,
        fileNamingContext?: FileNamingContext,
    ): Promise<string | null> =>
        safeInvoke("save_sticker_image_as", {
            base64Image: base64,
            dialogCenterX,
            dialogCenterY,
            fileNamingContext,
        }),
    openImageForEdit: (): Promise<string | null> =>
        safeInvoke("open_image_for_edit", undefined, () => null, false),
    readClipboardImage: (): Promise<string | null> =>
        safeInvoke("read_clipboard_image", undefined, () => null, false),

    copyNodeImageToClipboard: (base64: string, fileNamingContext?: FileNamingContext): Promise<string> =>
        safeInvoke(
            "copy_node_image_to_clipboard",
            { base64Image: base64, fileNamingContext },
            () => "browser-preview",
            false,
        ),
    copyToClipboard: (base64: string): Promise<void> =>
        safeInvoke("copy_to_clipboard", { base64Image: base64 }, () => undefined, false),
    copyStickerImageToSmartClipboard: (base64: string, fileNamingContext?: FileNamingContext): Promise<string> =>
        safeInvoke(
            "copy_sticker_image_to_smart_clipboard",
            { base64Image: base64, fileNamingContext },
            () => "browser-preview",
            false,
        ),
};

export const listenBrowserLoomHookMethod = (
    method: string,
    handler: BrowserPushHandler,
): (() => void) => {
    const handlers = browserPushHandlers.get(method) || new Set<BrowserPushHandler>();
    handlers.add(handler);
    browserPushHandlers.set(method, handlers);
    ensureBrowserPushSocket();

    return () => {
        const existing = browserPushHandlers.get(method);
        if (!existing) return;
        existing.delete(handler);
        if (existing.size === 0) {
            browserPushHandlers.delete(method);
        }
        stopBrowserPushSocketIfUnused();
    };
};
