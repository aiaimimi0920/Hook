import { invoke } from "@tauri-apps/api/core";
import { HandshakeRequest, HandshakeResponse } from "./protocol";
import { ShaderResponse } from "../components/ShaderRenderer";
import { BootProfile, defaultBootProfile, normalizeBootProfile } from "./bootProfile";
import type { FrozenStickerEntry } from "./stickerSnapshot";
import type {
    LongCaptureAxis,
    LongCaptureDirection,
    LongCaptureOverlapAnalysis,
} from "./captureState";

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
    stickers: any[];
    links: any[];
    groups?: any[];
    recycleBin?: FrozenStickerEntry[];
    referenceLibrary?: FrozenStickerEntry[];
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
    server_name: "browser-preview",
    capabilities: {
        art_definitions: [],
    },
    negotiated_transport: "shared_memory",
    session_id: "browser-preview",
};

const warnedMethods = new Set<string>();
const BROWSER_ARTLOOM_WS_URL = "ws://127.0.0.1:19820";
const BROWSER_SESSION_STORAGE_KEY = "hook_browser_preview_session";
const BROWSER_WS_REQUEST_TIMEOUT_MS = 20000;
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
type BrowserPushHandler = (payload: any) => void;
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

const browserArtLoomRequest = async <T = any>(request: { method: string; params?: any }): Promise<T> => {
    if (typeof WebSocket === "undefined") {
        throw new Error("WebSocket unavailable in current browser environment");
    }

    return new Promise<T>((resolve, reject) => {
        const ws = new WebSocket(BROWSER_ARTLOOM_WS_URL);
        let settled = false;

        const timeout = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            ws.close();
            reject(new Error(`ArtLoom WebSocket request timed out: ${request.method}`));
        }, BROWSER_WS_REQUEST_TIMEOUT_MS);

        ws.onerror = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error(`ArtLoom WebSocket connection failed: ${request.method}`));
        };

        ws.onopen = () => {
            ws.send(JSON.stringify(request));
        };

        ws.onclose = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeout);
            reject(new Error(`ArtLoom WebSocket closed before response: ${request.method}`));
        };

        ws.onmessage = (event) => {
            try {
                const parsed = JSON.parse(String(event.data));
                if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") {
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

const artLoomIpcRequest = async <T = any>(method: string, params?: any): Promise<T> => {
    interface ErrorResponse {
        type?: string;
        data?: { message?: string } & T;
        message?: string;
    }

    const response = await browserArtLoomRequest<ErrorResponse>({
        method,
        params,
    });

    if (response?.type === "error") {
        const errorMessage =
            (response.data && typeof response.data === "object" && "message" in response.data
                ? response.data.message
                : undefined) ||
            response.message ||
            `ArtLoom IPC request failed: ${method}`;
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

    browserPushSocket = new WebSocket(BROWSER_ARTLOOM_WS_URL);

    browserPushSocket.onopen = () => {
        try {
            const channels = Array.from(browserPushHandlers.keys());
            browserPushSocket?.send(JSON.stringify({
                method: "subscribe",
                params: { channels },
            }));
        } catch (error) {
            console.error("[API] Failed to subscribe browser push socket:", error);
        }
    };

    browserPushSocket.onmessage = (event) => {
        try {
            const parsed = JSON.parse(String(event.data));
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
        const handshake = await browserArtLoomRequest<{ type?: string; data?: { session_id?: string } }>({
            method: "handshake",
            params: { client_version: "browser-preview" },
        });
        const arts = await browserArtLoomRequest<{ type?: string; data?: any[] }>({
            method: "get_enabled_arts",
        });

        return {
            server_name: "artloom-browser-ws",
            capabilities: {
                art_definitions: Array.isArray(arts?.data) ? arts.data : [],
            },
            negotiated_transport: "shared_memory",
            session_id: handshake?.data?.session_id || "browser-preview",
        };
    } catch (error) {
        console.warn("[API] browserArtLoom handshake fallback failed:", error);
        return EMPTY_HANDSHAKE;
    }
};

const browserDispatchActionFallback = async (actionEnum: { action: string; payload: any }): Promise<void> => {
    try {
        switch (actionEnum.action) {
            case "sync_workflow":
                await browserArtLoomRequest({
                    method: "art_loom/overwrite_workflow",
                    params: {
                        workflow_id: actionEnum.payload.workflow_id,
                        snapshot: actionEnum.payload.snapshot,
                    },
                });
                return;
            case "update_node_param":
                if (actionEnum.payload?.origin_workflow_id && actionEnum.payload?.origin_node_id) {
                    await browserArtLoomRequest({
                        method: "art_loom/update_workflow_node",
                        params: {
                            workflow_id: actionEnum.payload.origin_workflow_id,
                            node_id: actionEnum.payload.origin_node_id,
                            param: actionEnum.payload.param_key,
                            value: actionEnum.payload.value,
                        },
                    });
                }
                return;
            default:
                warnBrowserFallback(`dispatch:${actionEnum.action}`);
                return;
        }
    } catch (error) {
        console.warn(`[API] browser dispatch fallback failed for ${actionEnum.action}:`, error);
    }
};

const loadBrowserPreviewSession = (): SessionData => {
    try {
        const raw = window.localStorage.getItem(BROWSER_SESSION_STORAGE_KEY);
        if (!raw) {
            return { stickers: [], links: [], groups: [], recycleBin: [], referenceLibrary: [] };
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.stickers) && Array.isArray(parsed?.links)) {
            return {
                stickers: parsed.stickers,
                links: parsed.links,
                groups: Array.isArray(parsed?.groups) ? parsed.groups : [],
                recycleBin: Array.isArray(parsed?.recycleBin) ? parsed.recycleBin : [],
                referenceLibrary: Array.isArray(parsed?.referenceLibrary) ? parsed.referenceLibrary : [],
            } as SessionData;
        }
    } catch (error) {
        console.warn("[API] Failed to parse browser preview session:", error);
    }

    return { stickers: [], links: [], groups: [], recycleBin: [], referenceLibrary: [] };
};

const trimBrowserSessionValue = (value: unknown) => {
    if (typeof value === "string" && value.startsWith("data:") && value.length > BROWSER_SESSION_DATA_URL_THRESHOLD) {
        return null;
    }
    return value;
};

const compactBrowserPreviewSession = (
    stickers: any[],
    links: any[],
    groups: any[] = [],
    recycleBin: FrozenStickerEntry[] = [],
    referenceLibrary: FrozenStickerEntry[] = [],
): SessionData => ({
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
});

const saveBrowserPreviewSession = (
    stickers: any[],
    links: any[],
    groups: any[] = [],
    recycleBin: FrozenStickerEntry[] = [],
    referenceLibrary: FrozenStickerEntry[] = [],
) => {
    try {
        window.localStorage.setItem(
            BROWSER_SESSION_STORAGE_KEY,
            JSON.stringify({ stickers, links, groups, recycleBin, referenceLibrary }),
        );
    } catch (error) {
        try {
            const compact = compactBrowserPreviewSession(
                stickers,
                links,
                groups,
                recycleBin,
                referenceLibrary,
            );
            window.localStorage.setItem(
                BROWSER_SESSION_STORAGE_KEY,
                JSON.stringify(compact),
            );
        } catch (compactError) {
            console.warn("[API] Failed to save browser preview session:", compactError);
        }
    }
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

    // --- ArtLoom Protocol ---
    handshake: (request: HandshakeRequest): Promise<HandshakeResponse> =>
        safeInvoke("artloom_handshake", { request }, browserHandshakeFallback, false),

    dispatchAction: (actionEnum: { action: string; payload: any }): Promise<void> =>
        safeInvoke(
            "artloom_dispatch_action",
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
    ): Promise<void> =>
        safeInvoke(
            "save_session",
            { stickers, links, groups, recycleBin, referenceLibrary },
            () => saveBrowserPreviewSession(stickers, links, groups, recycleBin, referenceLibrary),
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

    getInstalledFonts: (): Promise<string[]> =>
        safeInvoke("get_installed_fonts", undefined, () => [], false),

    // --- UI / Overlay ---
    updatePinRects: (rects: PinRect[]): Promise<void> =>
        safeInvoke("update_pin_rects", { rects }, () => undefined, false),

    initializeOverlay: (): Promise<void> =>
        safeInvoke("initialize_overlay", undefined, () => undefined, false),

    showOverlayHost: (clickThrough = true): Promise<void> =>
        safeInvoke("show_overlay_host", { clickThrough }, () => undefined, false),

    setOverlayClickThrough: (clickThrough: boolean): Promise<void> =>
        safeInvoke("set_overlay_click_through", { clickThrough }, () => undefined, false),

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

    debugLogEvent: (event: string, detail?: string): Promise<void> =>
        safeInvoke("append_runtime_log", { event, detail }, () => undefined, false),

    setMouseMonitorActive: (active: boolean): Promise<void> =>
        safeInvoke("set_mouse_monitor_active", { active }, () => undefined, false),

    // --- Shader ---
    prefetchShader: (args: { artId: string, artPath: string | null, inputPath: string | null, referencePath: string | null }): Promise<ShaderResponse> =>
        safeInvoke("prefetch_shader", args, () => ({
            type: "unsupported",
            success: false,
        }), false),

    getEnhancementCapabilities: (): Promise<EnhancementCapabilities> =>
        artLoomIpcRequest<EnhancementCapabilities>("art_loom/get_capabilities").catch(() => ({
            ocr: false,
            translation: false,
        })),

    // --- OCR & Capture ---
    performOcr: (imageBase64: string): Promise<OcrResult> =>
        artLoomIpcRequest("art_loom/ocr_image", { image_base64: imageBase64 }),

    translateText: (text: string, targetLang: string): Promise<string> =>
        artLoomIpcRequest<{ translated_text: string }>("art_loom/translate_text", {
            text,
            target_lang: targetLang,
        }).then((result) => result.translated_text),

    triggerOcrEvent: (): Promise<void> =>
        safeInvoke("trigger_ocr_event", undefined, () => undefined, false),

    captureRegion: (x: number, y: number, w: number, h: number): Promise<CaptureResponse> => {
        console.log("[API] captureRegion called with:", { x, y, w, h });
        return safeInvoke("capture_region", { x, y, w, h });
    },
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

    beginStickerNativeFileDrag: (base64: string, filenameHint?: string): Promise<string> =>
        safeInvoke(
            "begin_sticker_native_file_drag",
            { base64Image: base64, filenameHint },
            () => {
                throw new Error("Native sticker file drag requires the Tauri desktop runtime");
            },
            false,
        ),

    beginStickerNativeFileDragFromPath: (path: string): Promise<string> =>
        safeInvoke(
            "begin_sticker_native_file_drag_from_path",
            { path },
            () => {
                throw new Error("Native sticker file drag from path requires the Tauri desktop runtime");
            },
            false,
        ),

    saveStickerImage: (base64: string): Promise<string> =>
        safeInvoke("save_sticker_image", { base64Image: base64 }),
    saveStickerImageAs: (base64: string, dialogCenterX: number, dialogCenterY: number): Promise<string | null> =>
        safeInvoke("save_sticker_image_as", { base64Image: base64, dialogCenterX, dialogCenterY }),
    openImageForEdit: (): Promise<string | null> =>
        safeInvoke("open_image_for_edit", undefined, () => null, false),
    readClipboardImage: (): Promise<string | null> =>
        safeInvoke("read_clipboard_image", undefined, () => null, false),

    copyNodeImageToClipboard: (base64: string): Promise<string> =>
        safeInvoke("copy_node_image_to_clipboard", { base64Image: base64 }, () => "browser-preview", false),
    copyToClipboard: (base64: string): Promise<void> =>
        safeInvoke("copy_to_clipboard", { base64Image: base64 }, () => undefined, false),
    copyStickerImageToSmartClipboard: (base64: string): Promise<string> =>
        safeInvoke("copy_sticker_image_to_smart_clipboard", { base64Image: base64 }, () => "browser-preview", false),
};

export const listenBrowserArtLoomMethod = (
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
