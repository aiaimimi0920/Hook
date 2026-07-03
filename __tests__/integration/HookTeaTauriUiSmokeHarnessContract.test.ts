import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const harnessPath = resolve(process.cwd(), "..", "scripts", "smoke-hook-tea-tauri-ui-real.ps1");
const harnessExists = existsSync(harnessPath);
const harnessSource = harnessExists ? readFileSync(harnessPath, "utf8") : "";

describe("Hook Tea native Tauri UI real smoke harness contract", () => {
  it("exists as an isolated root-level operator script with collision-resistant artifacts", () => {
    expect(harnessExists).toBe(true);
    expect(harnessSource).toContain("hook-tea-tauri-ui-real-$runId");
    expect(harnessSource).toContain("[guid]::NewGuid()");
    expect(harnessSource).toContain("summary.json");
    expect(harnessSource).toContain("tauri-ui-smoke.mjs");
    expect(harnessSource).toContain("tauri-smoke.conf.json");
  });

  it("launches the real Tauri/WebView path instead of injecting a browser preview bridge", () => {
    expect(harnessSource).toContain("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
    expect(harnessSource).toContain("WEBVIEW2_USER_DATA_FOLDER");
    expect(harnessSource).toContain("webview2_user_data_dir");
    expect(harnessSource).toContain("--remote-debugging-port=$DebugPort");
    expect(harnessSource).toContain("chromium.connectOverCDP");
    expect(harnessSource).toContain("npm.cmd");
    expect(harnessSource).toContain("tauri.cmd");
    expect(harnessSource).toContain("--config");
    expect(harnessSource).toContain("HOOK_TEA_BASE_URL");
    expect(harnessSource).toContain("HOOK_TEA_AUTH_TOKEN");
    expect(harnessSource).toContain("HOOK_INITIAL_UI_MODE");
    expect(harnessSource).not.toContain("page.addInitScript");
    expect(harnessSource).not.toContain("__hookTeaUiSmokeInvoke");
  });

  it("triggers the actual WebView automation entry and verifies the Rust command side effect", () => {
    expect(harnessSource).toContain('data-testid="tea-ticket-button"');
    expect(harnessSource).toContain('data-testid="tea-ticket-output"');
    expect(harnessSource).toContain("attachedLocatorOnAnyPage");
    expect(harnessSource).toContain('state: "attached"');
    expect(harnessSource).toContain("element.click()");
    expect(harnessSource).toContain("native_tauri_runtime");
    expect(harnessSource).toContain("frontend_ticket_recorded");
    expect(harnessSource).toContain("runtime_log_contains_ticket");
    expect(harnessSource).toContain("tea_ticket_created :: id=");
    expect(harnessSource).not.toContain('state: "visible"');
  });

  it("independently verifies Tea HTTP data and records cleanup evidence", () => {
    expect(harnessSource).toContain("/v1/tickets/$ticketId");
    expect(harnessSource).toContain("/v1/tickets/$ticketId/events");
    expect(harnessSource).toContain("/v1/tickets/$ticketId/export/markdown");
    expect(harnessSource).toContain("tea_api_verified");
    expect(harnessSource).toContain("tauri_command_tree_stopped");
    expect(harnessSource).toContain("hook_stopped");
    expect(harnessSource).toContain("hook_port_listener_count_after_stop");
    expect(harnessSource).toContain("debug_port_listener_count_after_stop");
    expect(harnessSource).toContain("store_files_before_cleanup");
    expect(harnessSource).toContain("runtime_log_tail");
    expect(harnessSource).toContain("stdout_tail");
    expect(harnessSource).toContain("stderr_tail");
  });

  it("refuses to run when selected Tea, Hook, or CDP ports already have listeners", () => {
    expect(harnessSource).toContain("Assert-NoPreexistingPortListeners");
    expect(harnessSource).toContain("blocked_preexisting_listener");
    expect(harnessSource).toContain("preexisting_tea_listeners");
    expect(harnessSource).toContain("preexisting_hook_listeners");
    expect(harnessSource).toContain("preexisting_debug_listeners");
    expect(harnessSource).toContain("Refusing to run Hook Tea Tauri UI smoke");
  });

  it("keeps cleanup progress visible and never marks passed before cleanup completes", () => {
    expect(harnessSource).toContain("validated_pending_cleanup");
    expect(harnessSource).toContain("cleanup_phase");
    expect(harnessSource).toContain("cleanup_detail");
    expect(harnessSource).toContain('"stopping_tauri"');
    expect(harnessSource).toContain('"stopping_tea_daemon"');
    expect(harnessSource).toContain('"collecting_evidence"');
    expect(harnessSource).toContain('"writing_final_summary"');
    expect(harnessSource).toContain('"complete"');

    const successPath = harnessSource.slice(
      harnessSource.indexOf("Invoke-Checked -FilePath \"node\""),
      harnessSource.indexOf("catch {"),
    );
    expect(successPath).not.toMatch(/\$summary\["status"\]\s*=\s*"passed"/);
  });

  it("guards recursive artifact cleanup with a separator-aware path boundary", () => {
    expect(harnessSource).toContain("Remove-SmokeDirectoryInsideArtifact");
    expect(harnessSource).toContain("resolvedRootWithSeparator");
    expect(harnessSource).toContain("[System.IO.Path]::DirectorySeparatorChar");
    expect(harnessSource).toContain("[System.String]::Equals($resolvedPath, $resolvedRoot");
    expect(harnessSource).toContain("$resolvedPath.StartsWith($resolvedRootWithSeparator");
  });
});
