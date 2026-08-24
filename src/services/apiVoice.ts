// Owns the typed Talk/voice Tauri command boundary and browser preview defaults.
import { safeInvoke } from "./apiTransport";
import type {
    TalkVoiceCaptureRequest,
    TalkVoiceCaptureResult,
    VoiceSettingsSummary,
} from "./apiTypes";

const DEFAULT_VOICE_SETTINGS_SUMMARY: VoiceSettingsSummary = {
    shortcut: "Ctrl+Alt+Space",
    triggerMode: "toggle",
    audioBackend: "silent",
    providerKind: "mock",
    outputMode: "dry_run",
    clipboardBackend: "fallback",
    voiceMode: "dictate",
};

export const voiceApi = {
    getVoiceSettingsSummary: (): Promise<VoiceSettingsSummary> =>
        safeInvoke(
            "get_voice_settings_summary",
            undefined,
            () => ({ ...DEFAULT_VOICE_SETTINGS_SUMMARY }),
            false,
        ),

    captureTalkVoiceOnce: (request: TalkVoiceCaptureRequest = {}): Promise<TalkVoiceCaptureResult> =>
        safeInvoke("talk_capture_voice_once", { request }, () => {
            throw new Error("Talk voice capture requires the Tauri desktop runtime");
        }, false),
};
