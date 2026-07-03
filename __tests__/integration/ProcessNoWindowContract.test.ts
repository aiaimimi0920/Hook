import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Hook Windows child process contract", () => {
  it("keeps external CLI and Python art subprocesses hidden on Windows", () => {
    const processUtilsSource = readFileSync(
      resolve(process.cwd(), "src-tauri", "src", "process_utils.rs"),
      "utf8",
    );
    const libSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "lib.rs"), "utf8");
    const cliSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "cli_engine.rs"), "utf8");
    const mockArtLoomSource = readFileSync(
      resolve(process.cwd(), "src-tauri", "src", "mock_artloom.rs"),
      "utf8",
    );

    expect(processUtilsSource).toContain("pub fn configure_child_no_window");
    expect(processUtilsSource).toContain("CREATE_NO_WINDOW");
    expect(libSource).toContain("mod process_utils;");
    expect(cliSource).toContain("use crate::process_utils::configure_child_no_window;");
    expect(cliSource).toContain("configure_child_no_window(");
    expect(mockArtLoomSource).toContain("use crate::process_utils::configure_child_no_window;");
    expect(mockArtLoomSource).toContain("configure_child_no_window(");
  });
});
