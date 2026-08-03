import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook Windows child process contract", () => {
  it("keeps Hook-owned helper subprocesses hidden on Windows", () => {
    const libSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");

    expect(libSource).toContain('std::process::Command::new("powershell.exe")');
    expect(libSource).toContain("const CREATE_NO_WINDOW: u32 = 0x0800_0000;");
    expect(libSource).toContain("command.creation_flags(CREATE_NO_WINDOW);");
    expect(libSource).not.toContain("mod process_utils;");
    expect(existsSync(resolve(process.cwd(), "src-tauri", "src", "process_utils.rs"))).toBe(false);
  });
});
