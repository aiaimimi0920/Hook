import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const harnessPath = resolve(process.cwd(), "..", "scripts", "smoke-hook-tea-ui-real.ps1");
const harnessExists = existsSync(harnessPath);
const harnessSource = harnessExists ? readFileSync(harnessPath, "utf8") : "";

describe("Hook Tea UI real smoke harness contract", () => {
  it("exists as a root-level operator script with collision-resistant artifacts", () => {
    expect(harnessExists).toBe(true);
    expect(harnessSource).toContain("hook-tea-ui-real-$runId");
    expect(harnessSource).toContain("[guid]::NewGuid()");
    expect(harnessSource).toContain("summary.json");
    expect(harnessSource).toContain("ui-smoke.mjs");
  });

  it("triggers the non-visual Hook automation entry through a browser preview with a Tauri invoke bridge", () => {
    expect(harnessSource).toContain("page.addInitScript");
    expect(harnessSource).toContain("__TAURI_INTERNALS__");
    expect(harnessSource).toContain("page.exposeFunction");
    expect(harnessSource).toContain("create_tea_ticket");
    expect(harnessSource).toContain('data-testid="tea-ticket-button"');
    expect(harnessSource).toContain('data-testid="tea-ticket-output"');
    expect(harnessSource).toContain('state: "attached"');
    expect(harnessSource).toContain("element.click()");
    expect(harnessSource).toContain("Hook desktop ticket request (automation)");
    expect(harnessSource).not.toContain('state: "visible"');
    expect(harnessSource).not.toContain("Hook desktop ticket request (panel)");
  });

  it("verifies the ticket through Tea HTTP and records UI/cleanup evidence", () => {
    expect(harnessSource).toContain("/v1/intake/hook");
    expect(harnessSource).toContain("/v1/tickets/$ticketId");
    expect(harnessSource).toContain("/v1/tickets/$ticketId/events");
    expect(harnessSource).toContain("/v1/tickets/$ticketId/export/markdown");
    expect(harnessSource).toContain("frontend_ticket_recorded");
    expect(harnessSource).toContain("tea_api_verified");
    expect(harnessSource).toContain("hook_server_stopped");
    expect(harnessSource).toContain("hook_port_listener_count_after_stop");
    expect(harnessSource).toContain("store_files_before_cleanup");
    expect(harnessSource).toContain("stdout_tail");
    expect(harnessSource).toContain("stderr_tail");
  });

  it("retries automatically selected Tea ports when Windows refuses the bind", () => {
    expect(harnessSource).toContain("Start-TeaDaemonWithPortRetry");
    expect(harnessSource).toContain("Test-TeaDaemonBindFailure");
    expect(harnessSource).toContain("os error 10013");
    expect(harnessSource).toContain("Get-FreeTcpPort");
    expect(harnessSource).toContain("tea_bind_attempts");
  });
});
