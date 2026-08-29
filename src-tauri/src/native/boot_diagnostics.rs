// Owns CLI diagnostics, boot-profile environment parsing, and smoke request contracts.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BootProfile {
    startup_mode: String,
    initial_ui_mode: String,
    auto_start_capture: bool,
    loom_hook_enabled: bool,
    loom_hook_ws_url: String,
    native_acceptance: bool,
}

const NATIVE_ACCEPTANCE_ENV: &str = "HOOK_NATIVE_ACCEPTANCE";

fn native_acceptance_enabled_value(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
}

fn native_acceptance_enabled() -> bool {
    native_acceptance_enabled_value(std::env::var(NATIVE_ACCEPTANCE_ENV).ok().as_deref())
}

fn native_acceptance_marker_is_valid(marker: &str) -> bool {
    !marker.is_empty()
        && marker.len() <= 128
        && marker
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn read_env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(default)
}

fn boot_profile_from_env() -> BootProfile {
    let startup_mode = match std::env::var("HOOK_STARTUP_MODE") {
        Ok(value) if value.trim().eq_ignore_ascii_case("visible") => "visible".to_string(),
        _ => "silent".to_string(),
    };

    let initial_ui_mode = match std::env::var("HOOK_INITIAL_UI_MODE") {
        Ok(value) if value.trim().eq_ignore_ascii_case("overlay") => "overlay".to_string(),
        Ok(value) if value.trim().eq_ignore_ascii_case("canvas") => "canvas".to_string(),
        Ok(value) if value.trim().eq_ignore_ascii_case("tray") => "tray".to_string(),
        _ if startup_mode == "visible" => "overlay".to_string(),
        _ => "overlay".to_string(),
    };

    let loom_hook_ws_url = std::env::var("LOOM_HOOK_WS_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ws://127.0.0.1:19820".to_string());

    BootProfile {
        startup_mode,
        initial_ui_mode,
        auto_start_capture: read_env_bool("HOOK_AUTOSTART_CAPTURE", false),
        loom_hook_enabled: read_env_bool("HOOK_ENABLE_LOOM_HOOK", false),
        loom_hook_ws_url,
        native_acceptance: native_acceptance_enabled(),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfCheckCapabilities {
    desktop: bool,
    capture: bool,
    loom_connector: bool,
    talk_connector: bool,
    tea_connector: bool,
    voice: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfCheckReport {
    app: &'static str,
    binary: &'static str,
    version: &'static str,
    status: &'static str,
    capabilities: SelfCheckCapabilities,
    runtime: SelfCheckRuntime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelfCheckRuntime {
    process_id: u32,
    process_handle_count: Option<u32>,
}

#[cfg(windows)]
fn process_handle_count() -> Option<u32> {
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessHandleCount};

    let mut count = 0u32;
    unsafe { GetProcessHandleCount(GetCurrentProcess(), &mut count) }
        .ok()
        .map(|()| count)
}

#[cfg(not(windows))]
fn process_handle_count() -> Option<u32> {
    None
}

pub fn self_check_report() -> SelfCheckReport {
    SelfCheckReport {
        app: "Hook",
        binary: "hook.exe",
        version: env!("CARGO_PKG_VERSION"),
        status: "ok",
        capabilities: SelfCheckCapabilities {
            desktop: true,
            capture: true,
            loom_connector: true,
            talk_connector: true,
            tea_connector: true,
            voice: true,
        },
        runtime: SelfCheckRuntime {
            process_id: std::process::id(),
            process_handle_count: process_handle_count(),
        },
    }
}

pub fn self_check_report_json() -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&self_check_report())
}

pub fn loom_brain_plan_smoke_request() -> loom_connector::LoomBrainPlanRequest {
    loom_connector::LoomBrainPlanRequest {
        request_id: Some("hook-loom-smoke-1".to_string()),
        goal: "Hook Loom release smoke".to_string(),
        constraints: vec!["no-ui".to_string()],
        context: Some(serde_json::json!({
            "source": "hook-cli-smoke"
        })),
        timeout_ms: Some(5_000),
    }
}

pub fn loom_brain_plan_smoke_report_json() -> Result<String, String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create Loom smoke runtime: {error}"))?;
    let result = runtime
        .block_on(loom_connector::invoke_brain_plan(
            loom_brain_plan_smoke_request(),
        ))
        .map_err(|error| error.to_string())?;
    if result.status != "succeeded" {
        let body = serde_json::to_string(&result)
            .unwrap_or_else(|error| format!("failed to serialize failed result: {error}"));
        return Err(format!(
            "Loom brain plan smoke returned non-succeeded status: {body}"
        ));
    }
    serde_json::to_string_pretty(&result)
        .map_err(|error| format!("failed to serialize Loom smoke result: {error}"))
}

pub fn talk_capture_smoke_request() -> talk_connector::TalkVoiceCaptureRequest {
    talk_connector::TalkVoiceCaptureRequest {
        request_id: Some("hook-talk-smoke-1".to_string()),
        mode: Some("dictation".to_string()),
        context: Some(serde_json::json!({
            "source": "hook-cli-smoke"
        })),
        timeout_ms: Some(5_000),
    }
}

pub fn talk_capture_smoke_report_json() -> Result<String, String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create Talk smoke runtime: {error}"))?;
    let result = runtime
        .block_on(talk_connector::capture_voice_once(
            talk_capture_smoke_request(),
        ))
        .map_err(|error| error.to_string())?;
    if result.status != "succeeded" {
        let body = serde_json::to_string(&result)
            .unwrap_or_else(|error| format!("failed to serialize failed result: {error}"));
        return Err(format!(
            "Talk voice capture smoke returned non-succeeded status: {body}"
        ));
    }
    serde_json::to_string_pretty(&result)
        .map_err(|error| format!("failed to serialize Talk smoke result: {error}"))
}

pub fn hook_help_text() -> &'static str {
    concat!(
        "Usage: hook [OPTIONS]\n",
        "\n",
        "Options:\n",
        "  --self-check              Print a no-GUI JSON self-check report and exit\n",
        "  --loom-brain-plan-smoke   Invoke Loom brain.plan through local capability discovery and exit\n",
        "  --talk-voice-capture-smoke Invoke Talk voice.capture.once through local capability discovery and exit\n",
        "  -h, --help                Print help\n",
        "  -V, --version             Print version\n",
        "\n",
        "Emergency exit:\n",
        "  Press Esc three times within 400 ms, or press Ctrl+Alt+Shift+F12.\n",
        "\n",
        "Environment:\n",
        "  HOOK_SELF_CHECK_OUTPUT          Optional file path for --self-check JSON output\n",
        "  HOOK_LOOM_BRAIN_PLAN_OUTPUT    Optional file path for --loom-brain-plan-smoke JSON output\n",
        "  HOOK_TALK_VOICE_CAPTURE_OUTPUT Optional file path for --talk-voice-capture-smoke JSON output\n",
        "  HOOK_CLI_OUTPUT                 Optional file path for --help/--version text output\n",
        "  HOOK_CAPTURE_DYNAMIC_RANGE      Region capture mode: auto (default), hdr, or sdr\n",
    )
}

pub fn hook_version_text() -> String {
    format!("hook {}", env!("CARGO_PKG_VERSION"))
}

pub fn write_optional_cli_output(env_name: &str, text: &str) -> std::io::Result<()> {
    if let Ok(path) = std::env::var(env_name) {
        if !path.trim().is_empty() {
            std::fs::write(path, text)?;
        }
    }
    Ok(())
}
