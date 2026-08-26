// Shared API DTOs remain type-only so transport and consumers do not acquire runtime dependencies.
import type { FrozenStickerEntry } from "./stickerSnapshot";
import type {
    SessionGroup,
    SessionLink,
    SessionSticker,
    WorkflowAssetArchiveIndex,
} from "../types/unit";

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
    /**
     * Hexadecimal HWND assigned by the native capture-window target list.
     * When present, the backend captures the window surface directly instead
     * of sampling the desktop composition behind it.
     */
    captureWindowId?: string;
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

export interface VoiceSettingsSummary {
    shortcut: string;
    triggerMode: string;
    audioBackend: string;
    providerKind: string;
    outputMode: string;
    clipboardBackend: string;
    voiceMode: string;
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

export interface ToolSettingsData {
    stickerToolSettings?: Record<string, unknown> | null;
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
