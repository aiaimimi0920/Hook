import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("runtime logging does not block screenshot interaction", () => {
  it("queues runtime log lines instead of opening and writing the log file on the caller thread", () => {
    const source = readSource("src-tauri/src/lib.rs");
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
    const source = readSource("src-tauri/src/lib.rs");

    expect(source).toContain('std::env::var("LOCALAPPDATA")');
    expect(source).toContain('.join("Hook")');
    expect(source).toContain('.join("logs")');
  });
});
