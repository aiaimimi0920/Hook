import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const harnessSource = readFileSync(
  resolve(process.cwd(), "..", "scripts", "smoke-hook-tea-real.ps1"),
  "utf8",
);

describe("Hook Tea real smoke harness contract", () => {
  it("records daemon cleanup and artifact retention evidence in the summary", () => {
    expect(harnessSource).toContain("run_id");
    expect(harnessSource).toContain("artifact_root");
    expect(harnessSource).toContain("daemon_pid");
    expect(harnessSource).toContain("daemon_exit_code");
    expect(harnessSource).toContain("daemon_stopped");
    expect(harnessSource).toContain("port_listener_count_after_stop");
    expect(harnessSource).toContain("listeners_after_stop");
    expect(harnessSource).toContain("keep_artifacts");
    expect(harnessSource).toContain("store_preserved");
    expect(harnessSource).toContain("store_created_before_cleanup");
    expect(harnessSource).toContain("store_size_before_cleanup_bytes");
    expect(harnessSource).toContain("cleanup_checked_at");
    expect(harnessSource).toContain("cleanup_error");
  });

  it("uses collision-resistant artifact directories and records full store sidecar evidence", () => {
    expect(harnessSource).toContain("$runId");
    expect(harnessSource).toContain("[guid]::NewGuid()");
    expect(harnessSource).toContain("hook-tea-real-$runId");
    expect(harnessSource).not.toContain("hook-tea-real-$timestamp");

    expect(harnessSource).toContain("Get-StoreFiles");
    expect(harnessSource).toContain("store_files_before_cleanup");
    expect(harnessSource).toContain("store_file_count_before_cleanup");
    expect(harnessSource).toContain("store_total_size_before_cleanup_bytes");
    expect(harnessSource).toContain("store_files_after_cleanup");
    expect(harnessSource).toContain("store_file_count_after_cleanup");
    expect(harnessSource).toContain("$storePath-shm");
    expect(harnessSource).toContain("$storePath-wal");
  });

  it("records bounded daemon log tails for failure triage", () => {
    expect(harnessSource).toContain("Get-LogTail");
    expect(harnessSource).toContain("stdout_tail");
    expect(harnessSource).toContain("stderr_tail");
    expect(harnessSource).toContain("[System.IO.FileShare]::ReadWrite");
    expect(harnessSource).toContain("[int]$Tail = 40");
    expect(harnessSource).not.toContain("Get-Content -LiteralPath $Path -Tail");
  });

  it("keeps cleanup progress visible and never writes a passed summary before cleanup completes", () => {
    expect(harnessSource).toContain("Write-SmokeSummary");
    expect(harnessSource).toContain("Set-SmokeCleanupPhase");
    expect(harnessSource).toContain("cleanup_phase");
    expect(harnessSource).toContain("cleanup_detail");
    expect(harnessSource).toContain('cleanup_phase = "not_started"');
    expect(harnessSource).toContain('cleanup_detail = "not_started"');
    expect(harnessSource).toContain('"stopping_daemon"');
    expect(harnessSource).toContain('"collecting_evidence"');
    expect(harnessSource).toContain('"collecting_store"');
    expect(harnessSource).toContain('"collecting_listeners"');
    expect(harnessSource).toContain('"collecting_process_state"');
    expect(harnessSource).toContain('"collecting_log_tails"');
    expect(harnessSource).toContain('"writing_final_summary"');
    expect(harnessSource).toContain('"complete"');
    expect(harnessSource).not.toContain(
      "Set-Content -LiteralPath $summaryPath",
    );

    const successPath = harnessSource.slice(
      harnessSource.indexOf('Invoke-Checked -FilePath "cargo"'),
      harnessSource.indexOf("catch {"),
    );
    expect(successPath).not.toMatch(/\$summary\["status"\]\s*=\s*"passed"/);
  });

  it("uses a bounded daemon-stop helper instead of waiting indefinitely in cleanup", () => {
    expect(harnessSource).toContain("Stop-SmokeDaemon");
    expect(harnessSource).toContain("Stop-SmokeDaemon -ProcessId $daemonPid");
    expect(harnessSource).toContain("$daemon.Dispose()");
    expect(harnessSource).toContain('$summary["daemon_exit_code"] = $daemonExitCode');
    expect(harnessSource).not.toContain("Stop-SmokeDaemon -Daemon $daemon");
    expect(harnessSource).not.toContain("Get-SmokeDaemonExitCode -Daemon $daemon");
    expect(harnessSource).not.toContain(".WaitForExit(");
  });

  it("does not shadow PowerShell automatic PID while parsing listener rows", () => {
    expect(harnessSource).not.toMatch(/\$pid\s*=/i);
  });

  it("runs checked commands from the requested working directory", () => {
    expect(harnessSource).toContain("Push-Location $WorkingDirectory");
    expect(harnessSource).toContain("Pop-Location");
  });
});
