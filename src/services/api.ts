// Stable public API facade. Domain clients own command routing and resource-specific fallbacks.
import { bootSettingsApi } from "./apiBootSettings";
import { barcodeApi } from "./apiBarcode";
import { captureApi } from "./apiCapture";
import { imageResourceApi } from "./apiImageResource";
import {
    loomEnhancementApi,
    loomPlanningApi,
    loomProtocolApi,
} from "./apiLoomSurface";
import { overlayWindowApi } from "./apiOverlayWindow";
import { sessionHistoryApi } from "./apiSessionHistory";
import { teaApi } from "./apiTea";
import { voiceApi } from "./apiVoice";

export { listenBrowserLoomHookMethod } from "./apiBrowserLoomTransport";
export { isTauriRuntimeAvailable } from "./apiTransport";
export type {
    BarcodeResult,
    BarcodeScanResult,
    CaptureRegionOptions,
    CaptureResponse,
    EnhancementCapabilities,
    LoomBrainPlanRequest,
    LoomBrainPlanResult,
    LoomInvokeErrorPayload,
    OcrResult,
    PinRect,
    PreciseSelectionResult,
    ScreenColorSample,
    SessionData,
    SessionSaveResult,
    TalkInvokeErrorPayload,
    TalkVoiceCaptureRequest,
    TalkVoiceCaptureResult,
    TeaHookAttachment,
    TeaHookContext,
    TeaHookIntakeRequest,
    TeaTicketSummary,
    ToolSettingsData,
    VoiceSettingsSummary,
} from "./apiTypes";

export const api = {
    ...bootSettingsApi,
    ...barcodeApi,
    ...voiceApi,
    ...loomPlanningApi,
    ...teaApi,
    ...loomProtocolApi,
    ...sessionHistoryApi,
    ...overlayWindowApi,
    ...loomEnhancementApi,
    ...captureApi,
    ...imageResourceApi,
};
