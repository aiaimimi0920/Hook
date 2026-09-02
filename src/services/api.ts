// Stable public API facade. Domain clients own command routing and resource-specific fallbacks.
import { bootSettingsApi } from "./apiBootSettings";
import { captureApi } from "./apiCapture";
import { externalUrlApi } from "./apiExternalUrl";
import { imageResourceApi } from "./apiImageResource";
import {
    loomPlanningApi,
    loomProtocolApi,
    loomShaderApi,
} from "./apiLoomSurface";
import { overlayWindowApi } from "./apiOverlayWindow";
import { sessionHistoryApi } from "./apiSessionHistory";
import { teaApi } from "./apiTea";
import { voiceApi } from "./apiVoice";

export { listenBrowserLoomHookMethod } from "./apiBrowserLoomTransport";
export { isTauriRuntimeAvailable } from "./apiTransport";
export type {
    CaptureRegionOptions,
    CaptureResponse,
    LoomBrainPlanRequest,
    LoomBrainPlanResult,
    LoomInvokeErrorPayload,
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
    ...voiceApi,
    ...loomPlanningApi,
    ...teaApi,
    ...loomProtocolApi,
    ...sessionHistoryApi,
    ...overlayWindowApi,
    ...loomShaderApi,
    ...captureApi,
    ...externalUrlApi,
    ...imageResourceApi,
};
