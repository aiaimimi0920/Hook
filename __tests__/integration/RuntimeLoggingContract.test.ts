import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { readHookLibRustSources } from "../helpers/hookLibRustSources";

describe("runtime logging does not block screenshot interaction", () => {
  it("records the running executable identity and the actual live source without page credentials", () => {
    const setup = readFileSync(resolve(process.cwd(), "src-tauri/src/native/app_setup.rs"), "utf8");
    expect(setup).toContain("std::env::current_exe()");
    expect(setup).toContain("runtime_identity :: version={} pid={} executable={}");
    const controller = readFileSync(resolve(process.cwd(), "src/services/liveCaptureController.ts"), "utf8");
    const begin = controller.indexOf('debugLogEvent("live_capture_source_bound"');
    expect(begin).toBeGreaterThan(-1);
    const call = controller.slice(begin, controller.indexOf(".catch", begin));
    expect(call).toContain("status.sourceKind");
    expect(call).not.toMatch(/sourceTitle|browserGrantId|userGestureToken|sessionId/);
  });
  it("routes Live directly to native region selection without browser extension activation", () => {
    const source = readFileSync(resolve(process.cwd(), "src-tauri/src/native/capture_mode_entry.rs"), "utf8");
    const start = source.indexOf("fn enter_live_capture_mode");
    const branch = source.slice(start, source.indexOf("fn enter_long_capture_mode", start));
    expect(branch).toContain("try_begin_capture_input_runtime()");
    expect(branch).toContain("show_overlay_host_impl");
    expect(branch).toContain('emit("trigger-live-capture"');
    expect(branch).not.toContain("browser_live");
    expect(branch).not.toContain("set_focus");
    const app = readFileSync(resolve(process.cwd(), "src/app.tsx"), "utf8");
    expect(app).toContain("createLiveCaptureController(api)");
    expect(app).not.toContain("registerBrowserLiveEntries");
  });
  it("queues runtime log lines instead of opening and writing the log file on the caller thread", () => {
    const source = readHookLibRustSources();
    const appendStart = source.indexOf("pub(crate) fn append_runtime_log_line");
    const appendEnd = source.indexOf("fn unix_timestamp_millis", appendStart);
    const appendBlock = source.slice(appendStart, appendEnd);

    expect(source).toContain("RUNTIME_LOG_SENDER");
    expect(source).toContain("mpsc::sync_channel::<String>");
    expect(source).toContain("try_send(");
    expect(source).toContain("hook-runtime-log");
    expect(appendStart).toBeGreaterThan(-1);
    expect(appendEnd).toBeGreaterThan(appendStart);
    expect(appendBlock).toContain(".try_send(");
    expect(appendBlock).not.toContain("OpenOptions::new()");
    expect(appendBlock).not.toContain("File::create");
  });

  it("uses a local per-user log directory by default instead of the portable release folder that may live on a NAS share", () => {
    const configSource = readFileSync(resolve(process.cwd(), "launch-config.cmd"), "utf8");

    expect(configSource).toContain("if not defined HOOK_LOG_DIR");
    expect(configSource).toContain("%LOCALAPPDATA%\\Hook\\logs");
    expect(configSource).not.toContain('set "HOOK_LOG_DIR=%HOOK_PORTABLE_DIR%\\logs"');
  });

  it("falls back to a local per-user log directory even when hook.exe is launched directly", () => {
    const source = readHookLibRustSources();

    expect(source).toContain('std::env::var("LOCALAPPDATA")');
    expect(source).toContain('.join("Hook")');
    expect(source).toContain('.join("logs")');
  });

  it("redacts and bounds runtime messages before disk and panic console output", () => {
    const source = readHookLibRustSources();

    expect(source).toContain("sanitize_runtime_log_message(message)");
    expect(source).toContain("sanitize_runtime_log_message(line)");
    expect(source).toContain('const REDACTED_LOG_VALUE: &str = "[REDACTED]"');
    expect(source).toContain("RUNTIME_LOG_MESSAGE_LIMIT");
    expect(source).not.toContain("default_hook(info)");
  });
});
