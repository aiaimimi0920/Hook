import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Hook voice hotkey contract", () => {
  it("keeps the voice toggle state machine in Rust and emits a frontend status payload", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const hotkeySource = readSource("src-tauri/src/voice/hotkey.rs");
    const sessionSource = readSource("src-tauri/src/voice/session.rs");

    expect(hotkeySource).toContain("pub struct VoiceHotkeyEvent");
    expect(hotkeySource).toContain("handle_voice_toggle_hotkey");
    expect(hotkeySource).toContain("status_hint");
    expect(hotkeySource).toContain("recording");
    expect(hotkeySource).toContain("transcribing");
    expect(hotkeySource).toContain("rename_all = \"camelCase\"");

    expect(rustSource).toContain("HotkeyStateMachine::new_toggle(\"Ctrl+Alt+Space\")");
    expect(rustSource).toContain("handle_voice_toggle_hotkey(&mut hotkeys)");
    expect(rustSource).toContain('window.emit("voice-hotkey-event", voice_event)');
    expect(rustSource).toContain("register_voice_hotkey_success");
    expect(rustSource).toContain("Modifiers::CONTROL | Modifiers::ALT");
    expect(rustSource).toContain("Code::Space");

    expect(sessionSource).toContain("pub async fn run_voice_once");
    expect(rustSource).toContain("run_voice_once(&voice_config");
    expect(rustSource).toContain("VoiceRunOptions::default()");
    expect(rustSource).toContain('window.emit("voice-session-event"');
    expect(rustSource).toContain("voice_session_completed");
    expect(rustSource).toContain("voice_session_failed");
  });

  it("keeps voice status and settings wired without rendering a desktop overlay", () => {
    const rustSource = readSource("src-tauri/src/lib.rs");
    const apiSource = readSource("src/services/api.ts");
    const appSource = readSource("src/app.tsx");
    const cssSource = readSource("src/app.css");

    expect(rustSource).toContain("#[tauri::command]");
    expect(rustSource).toContain("fn get_voice_settings_summary() -> VoiceSettingsSummary");
    expect(rustSource).toContain("struct VoiceSettingsSummary");
    expect(rustSource).toContain("default_voice_config()");
    expect(rustSource).toContain("trigger_mode:");
    expect(rustSource).toContain("audio_backend:");
    expect(rustSource).toContain("provider_kind:");
    expect(rustSource).toContain("output_mode:");
    expect(rustSource).toContain("clipboard_backend:");
    expect(rustSource).toContain("voice_mode:");
    expect(rustSource).toContain("get_voice_settings_summary");

    expect(apiSource).toContain("export interface VoiceSettingsSummary");
    expect(apiSource).toContain("getVoiceSettingsSummary");
    expect(apiSource).toContain('safeInvoke("get_voice_settings_summary"');

    expect(appSource).toContain("VoiceSettingsSummary");
    expect(appSource).toContain("createSignal<VoiceSettingsSummary | null>(null)");
    expect(appSource).toContain("api.getVoiceSettingsSummary()");
    expect(appSource).toContain("setVoiceSettings(settings)");
    expect(appSource).toContain('listen<VoiceHotkeyPayload>("voice-hotkey-event"');
    expect(appSource).toContain("createSignal<VoiceStatus>(\"idle\")");
    expect(appSource).toContain("setVoiceStatus(resolveVoiceHotkeyStatus(event.payload))");
    expect(appSource).toContain('listen<VoiceSessionPayload>("voice-session-event"');
    expect(appSource).toContain("setLastVoiceSession(event.payload)");
    expect(appSource).toContain("resolveVoiceSessionStatus(event.payload)");
    expect(appSource).toContain("voice-settings-loaded");
    expect(appSource).toContain("voice-hotkey-listener");
    expect(appSource).toContain("voice-session-listener");
    expect(appSource).not.toContain('data-testid="voice-status-panel"');
    expect(appSource).not.toContain("fixed right-4 top-4");
    expect(appSource).not.toContain('class="voice-settings"');
    expect(appSource).not.toContain('class="voice-session-output"');
    expect(appSource).not.toContain("Rust-owned state machine");
    expect(appSource).not.toContain("Audio: Native Windows / Silent fallback config");
    expect(appSource).not.toContain("Output: Clipboard paste / dry-run config");
    expect(appSource).not.toContain("new VoiceSession");

    expect(cssSource).not.toContain(".voice-status-card");
    expect(cssSource).not.toContain(".voice-status-recording");
    expect(cssSource).not.toContain(".voice-status-transcribing");
    expect(cssSource).not.toContain(".voice-status-completed");
    expect(cssSource).not.toContain(".voice-status-failed");
  });
});
