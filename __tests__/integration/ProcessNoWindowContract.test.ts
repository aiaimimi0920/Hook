import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";

describe("Hook Windows child process contract", () => {
  it("keeps Hook-owned helper subprocesses hidden on Windows", () => {
    const libSource = readHookLibRustSources();

    const watchdogSource = readFileSync(
      resolve(process.cwd(), "src-tauri", "src", "emergency_watchdog.rs"),
      "utf8",
    );
    const imageSource = readFileSync(
      resolve(
        process.cwd(),
        "src-tauri",
        "src",
        "native",
        "image_path_commands.rs",
      ),
      "utf8",
    );

    // Downloads must stay in-process; the authenticated watchdog remains hidden.
    expect(libSource).not.toContain(
      'std::process::Command::new("powershell.exe")',
    );
    expect(imageSource).not.toContain("Command::new");
    expect(imageSource).toContain("use_native_tls()");
    expect(watchdogSource).toMatch(
      /Command::new\(executable\)[\s\S]*?\.creation_flags\(CREATE_NO_WINDOW\.0\)[\s\S]*?\.spawn\(\)/,
    );
    expect(libSource).not.toContain("mod process_utils;");
    expect(
      existsSync(
        resolve(process.cwd(), "src-tauri", "src", "process_utils.rs"),
      ),
    ).toBe(false);
  });
});
