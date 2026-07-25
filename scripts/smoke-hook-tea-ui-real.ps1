param(
    [int]$TeaPort = 0,
    [int]$HookPort = 0,
    [string]$AuthToken = "hook-tea-ui-smoke-token",
    [int]$TimeoutSec = 60,
    [switch]$KeepArtifacts
)

$ErrorActionPreference = "Stop"

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
    $listener.Start()
    try {
        return $listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

function Get-PortListeners {
    param(
        [int]$Port
    )

    $listeners = @()
    $lines = @(netstat -ano -p TCP 2>$null)
    foreach ($line in $lines) {
        $parts = @($line -split "\s+" | Where-Object { $_ -ne "" })
        if ($parts.Count -lt 5 -or $parts[0] -ne "TCP") {
            continue
        }

        $state = $parts[$parts.Count - 2]
        if ($state -ne "LISTENING") {
            continue
        }

        $localEndpoint = $parts[1]
        $lastColon = $localEndpoint.LastIndexOf(":")
        if ($lastColon -lt 0) {
            continue
        }

        $localPortText = $localEndpoint.Substring($lastColon + 1)
        $localPort = 0
        if (![int]::TryParse($localPortText, [ref]$localPort)) {
            continue
        }
        if ($localPort -ne $Port) {
            continue
        }

        $listenerPid = 0
        [void][int]::TryParse($parts[$parts.Count - 1], [ref]$listenerPid)
        $listeners += [pscustomobject]@{
            local_endpoint = $localEndpoint
            local_address = $localEndpoint.Substring(0, $lastColon)
            local_port = $localPort
            pid = $listenerPid
        }
    }

    return $listeners
}

function Get-LogTail {
    param(
        [string]$Path,
        [int]$Tail = 60
    )

    if (!(Test-Path -LiteralPath $Path)) {
        return @()
    }

    $stream = $null
    $reader = $null
    $lines = [System.Collections.Generic.List[string]]::new()

    try {
        $stream = [System.IO.FileStream]::new(
            $Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
        $reader = [System.IO.StreamReader]::new($stream)
        while (!$reader.EndOfStream) {
            $lines.Add($reader.ReadLine())
            if ($lines.Count -gt $Tail) {
                $lines.RemoveAt(0)
            }
        }
    }
    catch {
        $lines.Add("failed to read log tail: $($_.Exception.Message)")
    }
    finally {
        if ($reader -ne $null) {
            $reader.Dispose()
        }
        elseif ($stream -ne $null) {
            $stream.Dispose()
        }
    }

    return @($lines.ToArray())
}

function Test-TeaDaemonBindFailure {
    param(
        [string]$StderrPath
    )

    $stderrText = (@(Get-LogTail -Path $StderrPath -Tail 20) -join "`n")
    return (
        $stderrText -match "os error 10013" -or
        $stderrText -match "access permissions.*socket" -or
        $stderrText -match "Only one usage of each socket address" -or
        $stderrText -match "Address already in use" -or
        $stderrText -match "以一种访问权限不允许的方式"
    )
}

function Get-StoreFiles {
    param(
        [string]$StorePath
    )

    $paths = @(
        $StorePath,
        "$StorePath-shm",
        "$StorePath-wal"
    )
    $files = @()
    foreach ($path in $paths) {
        if (!(Test-Path -LiteralPath $path)) {
            continue
        }

        $item = Get-Item -LiteralPath $path
        $files += [pscustomobject]@{
            name = $item.Name
            path = $item.FullName
            length = $item.Length
        }
    }

    return $files
}

function Write-SmokeSummary {
    param(
        $Summary,
        [string]$Path
    )

    $Summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Set-SmokeCleanupPhase {
    param(
        $Summary,
        [string]$Path,
        [string]$Phase,
        [string]$Detail = $Phase
    )

    $Summary["cleanup_phase"] = $Phase
    $Summary["cleanup_detail"] = $Detail
    Write-SmokeSummary -Summary $Summary -Path $Path
}

function Stop-SmokeProcess {
    param(
        [int]$ProcessId,
        [string]$Name,
        [int]$TimeoutMs = 5000
    )

    if ($ProcessId -le 0) {
        return $true
    }

    if ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        return $true
    }

    Write-Host ">> stopping $Name pid=$ProcessId"
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    do {
        if ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            return $true
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)

    return ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    Write-Host ">> $FilePath $($Arguments -join ' ')"
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($exitCode -ne 0) {
        throw "Command failed with exit code $exitCode`: $FilePath $($Arguments -join ' ')"
    }
}

function Wait-TeaHealth {
    param(
        [string]$BaseUrl,
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            $Process.Refresh()
            throw "tea-daemon exited early with code $($Process.ExitCode)"
        }

        try {
            $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -TimeoutSec 2
            if ($health.status -eq "ok") {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 300
        }
    }

    throw "tea-daemon did not become healthy at $BaseUrl within $TimeoutSec seconds"
}

function Start-TeaDaemonWithPortRetry {
    param(
        [string]$TeaExe,
        [string]$TeaRoot,
        [int]$InitialPort,
        [bool]$AutoPort,
        [string]$StdoutPath,
        [string]$StderrPath,
        [int]$TimeoutSec,
        $Summary,
        [string]$SummaryPath
    )

    $maxAttempts = if ($AutoPort) { 5 } else { 1 }
    $port = $InitialPort

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        if ($AutoPort -and $attempt -gt 1) {
            $port = Get-FreeTcpPort
        }

        $baseUrlForAttempt = "http://127.0.0.1:$port"
        $env:TEA_BIND_ADDR = "127.0.0.1:$port"
        $Summary["base_url"] = $baseUrlForAttempt
        $Summary["tea_port"] = $port
        $Summary["tea_bind_attempts"] = $attempt

        Write-Host ">> starting tea-daemon at $baseUrlForAttempt (attempt $attempt/$maxAttempts)"
        $process = Start-Process -FilePath $TeaExe `
            -WorkingDirectory $TeaRoot `
            -RedirectStandardOutput $StdoutPath `
            -RedirectStandardError $StderrPath `
            -WindowStyle Hidden `
            -PassThru
        $Summary["daemon_pid"] = $process.Id
        Write-SmokeSummary -Summary $Summary -Path $SummaryPath

        try {
            Wait-TeaHealth -BaseUrl $baseUrlForAttempt -Process $process -TimeoutSec $TimeoutSec
            return [pscustomobject]@{
                process = $process
                port = $port
                base_url = $baseUrlForAttempt
                attempts = $attempt
            }
        }
        catch {
            $bindFailed = Test-TeaDaemonBindFailure -StderrPath $StderrPath
            if ($process -ne $null) {
                if (!$process.HasExited) {
                    [void](Stop-SmokeProcess -ProcessId $process.Id -Name "tea-daemon failed bind attempt" -TimeoutMs 5000)
                }
                $process.Dispose()
            }

            if ($AutoPort -and $bindFailed -and $attempt -lt $maxAttempts) {
                Write-Host ">> tea-daemon bind failed on auto port $port; retrying with a new port"
                continue
            }

            throw
        }
    }

    throw "tea-daemon did not bind after $maxAttempts attempts"
}

function Wait-HttpOk {
    param(
        [string]$Url,
        [System.Diagnostics.Process]$Process,
        [string]$Name,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            $Process.Refresh()
            throw "$Name exited early with code $($Process.ExitCode)"
        }

        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -Method Get -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 300
        }
    }

    throw "$Name did not become ready at $Url within $TimeoutSec seconds"
}

function Invoke-TeaText {
    param(
        [string]$Uri,
        [string]$AuthToken
    )

    $request = [System.Net.WebRequest]::Create($Uri)
    $request.Method = "GET"
    $request.Headers["Authorization"] = "Bearer $AuthToken"
    $response = $null
    $reader = $null
    try {
        $response = $request.GetResponse()
        $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
        return $reader.ReadToEnd()
    }
    finally {
        if ($reader -ne $null) {
            $reader.Dispose()
        }
        if ($response -ne $null) {
            $response.Dispose()
        }
    }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$hookRoot = Join-Path $repoRoot "Hook"
$teaRoot = Join-Path $repoRoot "Tea"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = "$timestamp-$(([guid]::NewGuid()).ToString("N").Substring(0, 8))"
$artifactRoot = Join-Path $repoRoot ".tmp\tea-smoke\hook-tea-ui-real-$runId"
$storePath = Join-Path $artifactRoot "tea-smoke.sqlite"
$teaStdoutPath = Join-Path $artifactRoot "tea-daemon.stdout.log"
$teaStderrPath = Join-Path $artifactRoot "tea-daemon.stderr.log"
$hookStdoutPath = Join-Path $artifactRoot "hook-static.stdout.log"
$hookStderrPath = Join-Path $artifactRoot "hook-static.stderr.log"
$uiSmokeScript = Join-Path $artifactRoot "ui-smoke.mjs"
$resultPath = Join-Path $artifactRoot "hook-tea-ui-real-result.json"
$summaryPath = Join-Path $artifactRoot "summary.json"

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

$autoTeaPort = ($TeaPort -eq 0)
if ($TeaPort -eq 0) {
    $TeaPort = Get-FreeTcpPort
}
if ($HookPort -eq 0) {
    $HookPort = Get-FreeTcpPort
}

$baseUrl = "http://127.0.0.1:$TeaPort"
$hookUrl = "http://127.0.0.1:$HookPort/"
$teaManifest = Join-Path $repoRoot "Tea\Cargo.toml"
$teaExe = Join-Path $repoRoot "Tea\target\debug\tea-daemon.exe"

$daemon = $null
$hookServer = $null
$daemonPid = 0
$hookServerPid = 0
$smokeSucceeded = $false
$teaApiVerified = $false

$summary = [ordered]@{
    status = "running"
    run_id = $runId
    artifact_root = $artifactRoot
    base_url = $baseUrl
    hook_url = $hookUrl
    ticket_id = $null
    ui_smoke_script = $uiSmokeScript
    result_path = $resultPath
    store_path = $storePath
    tea_stdout_path = $teaStdoutPath
    tea_stderr_path = $teaStderrPath
    hook_stdout_path = $hookStdoutPath
    hook_stderr_path = $hookStderrPath
    daemon_pid = $null
    hook_server_pid = $null
    frontend_ticket_recorded = $false
    tea_api_verified = $false
    event_count = $null
    labels = @()
    keep_artifacts = [bool]$KeepArtifacts
    cleanup_phase = "not_started"
    cleanup_detail = "not_started"
    cleanup_checked_at = $null
    cleanup_error = $null
    daemon_stopped = $false
    hook_server_stopped = $false
    port_listener_count_after_stop = $null
    hook_port_listener_count_after_stop = $null
    listeners_after_stop = @()
    hook_listeners_after_stop = @()
    store_files_before_cleanup = @()
    store_file_count_before_cleanup = $null
    store_total_size_before_cleanup_bytes = $null
    store_files_after_cleanup = @()
    store_file_count_after_cleanup = $null
    store_preserved = $null
    stdout_tail = @()
    stderr_tail = @()
    hook_stdout_tail = @()
    hook_stderr_tail = @()
    tea_port = $TeaPort
    tea_bind_attempts = 0
    started_at = (Get-Date).ToString("o")
    finished_at = $null
    error = $null
}

Write-SmokeSummary -Summary $summary -Path $summaryPath

@'
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

const require = createRequire(`${process.cwd()}\\package.json`);
const { chromium } = require("playwright");

const baseUrl = process.env.HOOK_TEA_UI_BASE_URL;
const authToken = process.env.HOOK_TEA_UI_AUTH_TOKEN;
const appUrl = process.env.HOOK_TEA_UI_APP_URL;
const resultPath = process.env.HOOK_TEA_UI_RESULT_PATH;

if (!baseUrl || !authToken || !appUrl || !resultPath) {
  throw new Error("HOOK_TEA_UI_BASE_URL, HOOK_TEA_UI_AUTH_TOKEN, HOOK_TEA_UI_APP_URL, and HOOK_TEA_UI_RESULT_PATH are required");
}

const consoleMessages = [];
const pageErrors = [];
const debugEvents = [];
const invokeCalls = [];
let createdTicket = null;
let createTicketRequest = null;

const writeResult = async (result) => {
  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
};

const postHookIntake = async (request) => {
  const response = await fetch(`${baseUrl}/v1/intake/hook`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Tea intake HTTP ${response.status}: ${body}`);
  }
  return JSON.parse(body);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error instanceof Error ? error.message : String(error));
  });

  await page.exposeFunction("__hookTeaUiSmokeInvoke", async (command, args = {}) => {
    invokeCalls.push({ command, args });
    switch (command) {
      case "plugin:event|listen":
        return invokeCalls.length;
      case "plugin:event|unlisten":
        return null;
      case "get_boot_profile":
        return {
          startupMode: "visible",
          initialUiMode: "canvas",
          autoStartCapture: false,
          artLoomEnabled: false,
          artLoomWsUrl: "ws://127.0.0.1:19820",
        };
      case "get_voice_settings_summary":
        return {
          shortcut: "Ctrl+Alt+Space",
          triggerMode: "toggle",
          audioBackend: "silent",
          providerKind: "mock",
          outputMode: "dry_run",
          clipboardBackend: "fallback",
          voiceMode: "dictate",
        };
      case "artloom_handshake":
        return {
          server_name: "hook-tea-ui-smoke",
          capabilities: { art_definitions: [] },
          negotiated_transport: "shared_memory",
          session_id: "hook-tea-ui-smoke",
        };
      case "load_session":
        return { stickers: [], links: [], groups: [] };
      case "save_session":
      case "show_canvas_window":
      case "show_overlay_host":
      case "set_mouse_monitor_active":
      case "set_overlay_click_through":
      case "update_pin_rects":
      case "artloom_dispatch_action":
      case "append_runtime_log":
        if (command === "append_runtime_log") {
          debugEvents.push(args);
        }
        return null;
      case "create_tea_ticket":
        createTicketRequest = args.request;
        createdTicket = await postHookIntake(args.request);
        return createdTicket;
      default:
        throw new Error(`Unexpected Tauri command in Hook Tea UI smoke: ${command}`);
    }
  });

  await page.addInitScript(() => {
    let nextCallbackId = 1;
    const callbacks = new Map();
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
    window.__TAURI_INTERNALS__ = {
      transformCallback: (callback, once = false) => {
        const id = nextCallbackId++;
        callbacks.set(id, { callback, once });
        return id;
      },
      invoke: (command, args) => window.__hookTeaUiSmokeInvoke(command, args || {}),
      convertFileSrc: (path) => path,
    };
  });

  await page.goto(appUrl, { waitUntil: "domcontentloaded" });
  const button = page.locator('[data-testid="tea-ticket-button"]');
  const output = page.locator('[data-testid="tea-ticket-output"]');
  await button.waitFor({ state: "attached", timeout: 20000 });
  await button.evaluate((element) => element.click());
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="tea-ticket-output"]')?.textContent || "";
    return /[0-9a-f-]{36}/i.test(text);
  }, { timeout: 20000 });

  const outputText = await output.evaluate((element) => element.textContent || "");
  const ticketId = outputText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || createdTicket?.id || null;
  if (!ticketId) {
    throw new Error(`Could not extract ticket id from output: ${outputText}`);
  }
  if (!createdTicket || createdTicket.id !== ticketId) {
    throw new Error(`UI ticket id did not match create_tea_ticket result: output=${ticketId} created=${createdTicket?.id}`);
  }
  if (!createTicketRequest?.text?.includes("Hook desktop ticket request (automation)")) {
    throw new Error("UI did not submit the expected automation Hook ticket text");
  }

  await writeResult({
    status: "passed",
    ticketId,
    outputText,
    frontendTicketRecorded: outputText.includes(ticketId),
    createTicketRequest,
    createdTicket,
    invokeCalls,
    debugEvents,
    consoleMessages,
    pageErrors,
  });
} catch (error) {
  await writeResult({
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    createdTicket,
    createTicketRequest,
    invokeCalls,
    debugEvents,
    consoleMessages,
    pageErrors,
  });
  throw error;
} finally {
  await browser.close();
}
'@ | Set-Content -LiteralPath $uiSmokeScript -Encoding UTF8

$oldEnv = @{
    TEA_BIND_ADDR = $env:TEA_BIND_ADDR
    TEA_AUTH_TOKEN = $env:TEA_AUTH_TOKEN
    TEA_STORE_PATH = $env:TEA_STORE_PATH
    TEA_LOOM_BASE_URL = $env:TEA_LOOM_BASE_URL
    TEA_LOOM_AUTH_TOKEN = $env:TEA_LOOM_AUTH_TOKEN
    HOOK_TEA_UI_BASE_URL = $env:HOOK_TEA_UI_BASE_URL
    HOOK_TEA_UI_AUTH_TOKEN = $env:HOOK_TEA_UI_AUTH_TOKEN
    HOOK_TEA_UI_APP_URL = $env:HOOK_TEA_UI_APP_URL
    HOOK_TEA_UI_RESULT_PATH = $env:HOOK_TEA_UI_RESULT_PATH
}

try {
    Invoke-Checked -FilePath "cargo" -WorkingDirectory $repoRoot -Arguments @(
        "build",
        "--manifest-path", $teaManifest,
        "-p", "tea-daemon"
    )

    if (!(Test-Path -LiteralPath $teaExe)) {
        throw "tea-daemon executable was not built at $teaExe"
    }

    Invoke-Checked -FilePath "npm.cmd" -WorkingDirectory $hookRoot -Arguments @("run", "build")

    $env:TEA_BIND_ADDR = "127.0.0.1:$TeaPort"
    $env:TEA_AUTH_TOKEN = $AuthToken
    $env:TEA_STORE_PATH = $storePath
    $env:TEA_LOOM_BASE_URL = ""
    $env:TEA_LOOM_AUTH_TOKEN = ""

    $daemonStart = Start-TeaDaemonWithPortRetry `
        -TeaExe $teaExe `
        -TeaRoot $teaRoot `
        -InitialPort $TeaPort `
        -AutoPort $autoTeaPort `
        -StdoutPath $teaStdoutPath `
        -StderrPath $teaStderrPath `
        -TimeoutSec $TimeoutSec `
        -Summary $summary `
        -SummaryPath $summaryPath
    $daemon = $daemonStart.process
    $daemonPid = $daemon.Id
    $TeaPort = [int]$daemonStart.port
    $baseUrl = [string]$daemonStart.base_url
    $summary["daemon_pid"] = $daemonPid
    $summary["base_url"] = $baseUrl
    $summary["tea_port"] = $TeaPort
    $summary["tea_bind_attempts"] = [int]$daemonStart.attempts
    Write-SmokeSummary -Summary $summary -Path $summaryPath

    Write-Host ">> starting Hook static preview at $hookUrl"
    $hookServer = Start-Process -FilePath "node.exe" `
        -ArgumentList @("scripts\serve-static.mjs", "--host", "127.0.0.1", "--port", "$HookPort", "--root", ".output/public") `
        -WorkingDirectory $hookRoot `
        -RedirectStandardOutput $hookStdoutPath `
        -RedirectStandardError $hookStderrPath `
        -WindowStyle Hidden `
        -PassThru
    $hookServerPid = $hookServer.Id
    $summary["hook_server_pid"] = $hookServerPid
    Write-SmokeSummary -Summary $summary -Path $summaryPath

    Wait-HttpOk -Url $hookUrl -Process $hookServer -Name "Hook static preview" -TimeoutSec $TimeoutSec

    $env:HOOK_TEA_UI_BASE_URL = $baseUrl
    $env:HOOK_TEA_UI_AUTH_TOKEN = $AuthToken
    $env:HOOK_TEA_UI_APP_URL = $hookUrl
    $env:HOOK_TEA_UI_RESULT_PATH = $resultPath

    Invoke-Checked -FilePath "node" -WorkingDirectory $hookRoot -Arguments @($uiSmokeScript)

    if (!(Test-Path -LiteralPath $resultPath)) {
        throw "Hook Tea UI smoke result was not written at $resultPath"
    }

    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    if ($result.status -ne "passed") {
        throw "Hook Tea UI smoke result status was $($result.status): $($result.error)"
    }
    if ([string]::IsNullOrWhiteSpace($result.ticketId)) {
        throw "Hook Tea UI smoke result did not contain ticketId"
    }
    if ($result.frontendTicketRecorded -ne $true) {
        throw "Hook Tea UI smoke did not confirm frontend_ticket_recorded"
    }

    $headers = @{ Authorization = "Bearer $AuthToken" }
    $ticketId = $result.ticketId
    $ticket = Invoke-RestMethod -Uri "$baseUrl/v1/tickets/$ticketId" -Headers $headers -Method Get -TimeoutSec 5
    $events = Invoke-RestMethod -Uri "$baseUrl/v1/tickets/$ticketId/events" -Headers $headers -Method Get -TimeoutSec 5
    $markdown = Invoke-TeaText -Uri "$baseUrl/v1/tickets/$ticketId/export/markdown" -AuthToken $AuthToken

    if ($ticket.id -ne $ticketId) {
        throw "Tea ticket id mismatch: expected $ticketId got $($ticket.id)"
    }
    if ($ticket.source -ne "hook") {
        throw "expected source=hook, got $($ticket.source)"
    }
    if ($ticket.approval_policy -ne "plan_only") {
        throw "expected approval_policy=plan_only, got $($ticket.approval_policy)"
    }
    if (!$ticket.description.Contains("Hook desktop ticket request (automation)")) {
        throw "ticket description does not contain Hook automation ticket text"
    }
    if (!$ticket.description.Contains("--- Hook context (untrusted) ---")) {
        throw "ticket description does not contain Hook context marker"
    }
    $labels = @($ticket.labels)
    foreach ($label in @("source:hook", "policy:plan-only", "context:untrusted")) {
        if ($labels -notcontains $label) {
            throw "ticket labels do not contain $label"
        }
    }
    if (@($events | Where-Object { $_.kind -eq "ticket_created" }).Count -lt 1) {
        throw "ticket events do not contain ticket_created"
    }
    if (!$markdown.Contains("Hook desktop ticket request (automation)")) {
        throw "markdown export does not contain Hook automation ticket text"
    }
    if (!$markdown.Contains("TicketCreated")) {
        throw "markdown export does not contain TicketCreated"
    }

    $teaApiVerified = $true
    $smokeSucceeded = $true
    $summary["status"] = "validated_pending_cleanup"
    $summary["ticket_id"] = $ticketId
    $summary["frontend_ticket_recorded"] = [bool]$result.frontendTicketRecorded
    $summary["tea_api_verified"] = $teaApiVerified
    $summary["event_count"] = @($events).Count
    $summary["labels"] = $labels
    Write-SmokeSummary -Summary $summary -Path $summaryPath

    Write-Host "Hook UI -> Tea real smoke validated; cleanup still pending"
    Write-Host "ticket_id=$ticketId"
    Write-Host "summary=$summaryPath"
}
catch {
    $summary["status"] = "failed"
    $summary["error"] = $_.Exception.Message
    Write-SmokeSummary -Summary $summary -Path $summaryPath
    throw
}
finally {
    $cleanupFailure = $null
    $daemonStopped = $false
    $hookServerStopped = $false
    $listenersAfterStop = @()
    $hookListenersAfterStop = @()
    $storeFilesBeforeCleanup = @()
    $storeTotalSizeBeforeCleanupBytes = $null
    $storeFilesAfterCleanup = @()

    try {
        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "stopping_servers" -Detail "stopping_hook_static"
        [void](Stop-SmokeProcess -ProcessId $hookServerPid -Name "Hook static preview" -TimeoutMs 5000)
        if ($hookServer -ne $null) {
            $hookServer.Dispose()
            $hookServer = $null
        }

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "stopping_servers" -Detail "stopping_tea_daemon"
        [void](Stop-SmokeProcess -ProcessId $daemonPid -Name "tea-daemon" -TimeoutMs 5000)
        if ($daemon -ne $null) {
            $daemon.Dispose()
            $daemon = $null
        }

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "collecting_evidence" -Detail "collecting_store"
        $storeFilesBeforeCleanup = @(Get-StoreFiles -StorePath $storePath)
        $storeTotalSizeBeforeCleanupBytes = 0
        foreach ($storeFile in $storeFilesBeforeCleanup) {
            $storeTotalSizeBeforeCleanupBytes += $storeFile.length
        }

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "collecting_evidence" -Detail "collecting_listeners"
        $listenersAfterStop = @(Get-PortListeners -Port $TeaPort)
        $hookListenersAfterStop = @(Get-PortListeners -Port $HookPort)
        $daemonStopped = [bool]($daemonPid -le 0 -or $null -eq (Get-Process -Id $daemonPid -ErrorAction SilentlyContinue))
        $hookServerStopped = [bool]($hookServerPid -le 0 -or $null -eq (Get-Process -Id $hookServerPid -ErrorAction SilentlyContinue))

        if (!$KeepArtifacts) {
            Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "removing_store"
            Remove-Item -LiteralPath $storePath -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath "$storePath-shm" -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath "$storePath-wal" -Force -ErrorAction SilentlyContinue
        }
        $storeFilesAfterCleanup = @(Get-StoreFiles -StorePath $storePath)

        if ($smokeSucceeded -and (!$daemonStopped -or !$hookServerStopped -or $listenersAfterStop.Count -ne 0 -or $hookListenersAfterStop.Count -ne 0)) {
            $cleanupFailure = "cleanup failed: daemon_stopped=$daemonStopped hook_server_stopped=$hookServerStopped port_listener_count_after_stop=$($listenersAfterStop.Count) hook_port_listener_count_after_stop=$($hookListenersAfterStop.Count)"
        }
    }
    catch {
        $cleanupFailure = $_.Exception.Message
    }
    finally {
        foreach ($entry in $oldEnv.GetEnumerator()) {
            if ($null -eq $entry.Value) {
                Remove-Item -Path "Env:$($entry.Key)" -ErrorAction SilentlyContinue
            }
            else {
                Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value
            }
        }

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "writing_final_summary" -Detail "collecting_log_tails"
        $summary["cleanup_checked_at"] = (Get-Date).ToString("o")
        $summary["daemon_stopped"] = $daemonStopped
        $summary["hook_server_stopped"] = $hookServerStopped
        $summary["port_listener_count_after_stop"] = $listenersAfterStop.Count
        $summary["hook_port_listener_count_after_stop"] = $hookListenersAfterStop.Count
        $summary["listeners_after_stop"] = $listenersAfterStop
        $summary["hook_listeners_after_stop"] = $hookListenersAfterStop
        $summary["store_files_before_cleanup"] = $storeFilesBeforeCleanup
        $summary["store_file_count_before_cleanup"] = $storeFilesBeforeCleanup.Count
        $summary["store_total_size_before_cleanup_bytes"] = $storeTotalSizeBeforeCleanupBytes
        $summary["store_files_after_cleanup"] = $storeFilesAfterCleanup
        $summary["store_file_count_after_cleanup"] = $storeFilesAfterCleanup.Count
        $summary["store_preserved"] = [bool](Test-Path -LiteralPath $storePath)
        $summary["stdout_tail"] = @(Get-LogTail -Path $teaStdoutPath)
        $summary["stderr_tail"] = @(Get-LogTail -Path $teaStderrPath)
        $summary["hook_stdout_tail"] = @(Get-LogTail -Path $hookStdoutPath)
        $summary["hook_stderr_tail"] = @(Get-LogTail -Path $hookStderrPath)
        $summary["finished_at"] = (Get-Date).ToString("o")

        if ($cleanupFailure -ne $null) {
            $summary["status"] = "failed"
            $summary["cleanup_error"] = $cleanupFailure
        }
        elseif ($smokeSucceeded -and $summary["status"] -ne "failed") {
            $summary["status"] = "passed"
        }

        $summary["cleanup_phase"] = "complete"
        $summary["cleanup_detail"] = "complete"
        Write-SmokeSummary -Summary $summary -Path $summaryPath

        if ($cleanupFailure -ne $null) {
            throw $cleanupFailure
        }
    }
}
