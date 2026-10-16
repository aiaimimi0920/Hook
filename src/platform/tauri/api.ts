// Stable public API facade. Domain clients own command routing and resource-specific fallbacks.
import { bootSettingsApi } from "./apiBootSettings";
import { captureApi } from "./apiCapture";
import { externalUrlApi } from "./apiExternalUrl";
import { imageResourceApi } from "./apiImageResource";
import { liveCaptureApi } from "./apiLiveCapture";
import { liveRelayApi } from "./apiLiveRelay";
import {
    loomPlanningApi,
    loomProtocolApi,
    loomShaderApi,
} from "./apiLoomSurface";
import { overlayWindowApi } from "./apiOverlayWindow";
import { sessionHistoryApi } from "./apiSessionHistory";
import { teaApi } from "./apiTea";
import { voiceApi } from "./apiVoice";

export { listenBrowserLoomOtterMethod } from "./apiBrowserLoomTransport";
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
    TeaOtterAttachment,
    TeaOtterContext,
    TeaOtterIntakeRequest,
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
    ...liveCaptureApi,
    ...liveRelayApi,
};
