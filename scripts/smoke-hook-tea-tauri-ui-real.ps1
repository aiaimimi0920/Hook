param(
    [int]$TeaPort = 0,
    [int]$HookPort = 0,
    [int]$DebugPort = 0,
    [string]$AuthToken = "hook-tea-tauri-ui-smoke-token",
    [int]$TimeoutSec = 120,
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

function ConvertTo-IsoTime {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }
    try {
        if ($Value -is [datetime]) {
            return $Value.ToString("o")
        }
        return ([System.Management.ManagementDateTimeConverter]::ToDateTime([string]$Value)).ToString("o")
    }
    catch {
        return [string]$Value
    }
}

function Get-ProcessInfo {
    param(
        [int]$TargetProcessId
    )

    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $TargetProcessId" -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
        return $null
    }

    return [pscustomobject]@{
        processId = [int]$proc.ProcessId
        parentProcessId = [int]$proc.ParentProcessId
        name = $proc.Name
        executablePath = $proc.ExecutablePath
        commandLine = $proc.CommandLine
        creationDate = ConvertTo-IsoTime $proc.CreationDate
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

        $listenerProcessId = 0
        [void][int]::TryParse($parts[$parts.Count - 1], [ref]$listenerProcessId)
        $listeners += [pscustomobject]@{
            local_endpoint = $localEndpoint
            local_address = $localEndpoint.Substring(0, $lastColon)
            local_port = $localPort
            pid = $listenerProcessId
            process = Get-ProcessInfo -TargetProcessId $listenerProcessId
        }
    }

    return $listeners
}

function Assert-NoPreexistingPortListeners {
    param(
        $Summary,
        [string]$SummaryPath,
        [object[]]$TeaListeners,
        [object[]]$HookListeners,
        [object[]]$DebugListeners
    )

    $preexistingCount = $TeaListeners.Count + $HookListeners.Count + $DebugListeners.Count
    $Summary["preexisting_tea_listeners"] = @($TeaListeners)
    $Summary["preexisting_hook_listeners"] = @($HookListeners)
    $Summary["preexisting_debug_listeners"] = @($DebugListeners)
    $Summary["preexisting_listener_count"] = $preexistingCount

    if ($preexistingCount -gt 0) {
        $Summary["status"] = "blocked_preexisting_listener"
        $Summary["error"] = "Refusing to run Hook Tea Tauri UI smoke because selected Tea, Hook, or CDP ports already have listeners"
        $Summary["finished_at"] = (Get-Date).ToString("o")
        Write-SmokeSummary -Summary $Summary -Path $SummaryPath
        throw $Summary["error"]
    }
}

function Get-LogTail {
    param(
        [string]$Path,
        [int]$Tail = 80
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

function Remove-SmokeDirectoryInsideArtifact {
    param(
        [string]$Path,
        [string]$ArtifactRoot
    )

    if (!(Test-Path -LiteralPath $Path)) {
        return $false
    }

    $trimSeparators = @(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path.TrimEnd($trimSeparators)
    $resolvedRoot = (Resolve-Path -LiteralPath $ArtifactRoot).Path.TrimEnd($trimSeparators)
    $resolvedRootWithSeparator = "$resolvedRoot$([System.IO.Path]::DirectorySeparatorChar)"
    $isArtifactRoot = [System.String]::Equals($resolvedPath, $resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)
    $isInsideArtifactRoot = $resolvedPath.StartsWith($resolvedRootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)
    if (!$isArtifactRoot -and !$isInsideArtifactRoot) {
        throw "Refusing recursive cleanup outside artifact root: path=$resolvedPath root=$resolvedRoot"
    }

    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
    return $true
}

function Write-SmokeSummary {
    param(
        $Summary,
        [string]$Path
    )

    $Summary | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $Path -Encoding UTF8
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

function Wait-CdpAvailable {
    param(
        [int]$Port,
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            $Process.Refresh()
            throw "Tauri dev command exited early with code $($Process.ExitCode)"
        }

        try {
            $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -Method Get -TimeoutSec 2
            if ($version.Browser) {
                return $version
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "WebView2 CDP endpoint did not become ready on port $Port within $TimeoutSec seconds"
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

function Get-ProcessTreeIds {
    param(
        [int[]]$RootIds
    )

    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $childrenByParent = @{}
    foreach ($proc in $all) {
        $parent = [int]$proc.ParentProcessId
        if (-not $childrenByParent.ContainsKey($parent)) {
            $childrenByParent[$parent] = [System.Collections.Generic.List[int]]::new()
        }
        $childrenByParent[$parent].Add([int]$proc.ProcessId)
    }

    $seen = [System.Collections.Generic.HashSet[int]]::new()
    $queue = [System.Collections.Generic.Queue[int]]::new()
    foreach ($rootId in $RootIds) {
        if ($rootId -gt 0 -and $seen.Add($rootId)) {
            $queue.Enqueue($rootId)
        }
    }

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        if ($childrenByParent.ContainsKey($current)) {
            foreach ($child in $childrenByParent[$current]) {
                if ($seen.Add($child)) {
                    $queue.Enqueue($child)
                }
            }
        }
    }

    return @($seen)
}

function Stop-PidSet {
    param(
        [int[]]$ProcessIds,
        [string]$Reason
    )

    $stopped = @()
    foreach ($targetProcessId in @($ProcessIds | Sort-Object -Descending -Unique)) {
        if ($targetProcessId -le 0) {
            continue
        }
        $proc = Get-Process -Id $targetProcessId -ErrorAction SilentlyContinue
        if ($null -eq $proc) {
            continue
        }
        $info = Get-ProcessInfo -TargetProcessId $targetProcessId
        [void](Stop-SmokeProcess -ProcessId $targetProcessId -Name $Reason -TimeoutMs 5000)
        $stopped += [pscustomobject]@{
            processId = $targetProcessId
            reason = $Reason
            process = $info
        }
    }

    return @($stopped)
}

function Get-NewHookProcesses {
    param(
        [string]$HookRoot,
        [datetime]$StartedAfter
    )

    $expectedPrefix = (Join-Path $HookRoot "src-tauri\target\debug").ToLowerInvariant()
    $items = @()
    foreach ($proc in @(Get-Process -Name hook -ErrorAction SilentlyContinue)) {
        $path = $proc.Path
        $start = $null
        try {
            $start = $proc.StartTime
        }
        catch {
            $start = $null
        }
        if ($path -and $path.ToLowerInvariant().StartsWith($expectedPrefix) -and $start -and $start -ge $StartedAfter) {
            $items += [pscustomobject]@{
                processId = [int]$proc.Id
                processName = $proc.ProcessName
                path = $path
                startTime = $start.ToString("o")
            }
        }
    }
    return @($items)
}

function Get-NewWebViewDebugProcesses {
    param(
        [int]$Port,
        [datetime]$StartedAfter
    )

    $items = @()
    foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue)) {
        $commandLine = [string]$proc.CommandLine
        if (!$commandLine.Contains("remote-debugging-port=$Port")) {
            continue
        }

        $created = $null
        try {
            $created = [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$proc.CreationDate)
        }
        catch {
            $created = $null
        }
        if ($created -and $created -lt $StartedAfter) {
            continue
        }

        $items += [pscustomobject]@{
            processId = [int]$proc.ProcessId
            processName = $proc.Name
            commandLine = $commandLine
            creationDate = ConvertTo-IsoTime $proc.CreationDate
        }
    }
    return @($items)
}

function Stop-SafeNewPortListeners {
    param(
        [int[]]$Ports,
        [int[]]$BaselinePids,
        [datetime]$StartedAfter,
        [string]$HookRoot,
        [int]$DebugPort
    )

    $stopped = @()
    foreach ($port in $Ports) {
        foreach ($listener in @(Get-PortListeners -Port $port)) {
            $listenerProcessId = [int]$listener.pid
            if ($BaselinePids -contains $listenerProcessId) {
                continue
            }

            $info = $listener.process
            if ($null -eq $info) {
                continue
            }

            $created = $null
            if ($info.creationDate) {
                try {
                    $created = [datetime]::Parse($info.creationDate)
                }
                catch {
                    $created = $null
                }
            }

            $commandLine = [string]$info.commandLine
            $safe =
                ($created -and $created -ge $StartedAfter) -and (
                    $commandLine.Contains("serve-static.mjs") -or
                    $commandLine.Contains("tauri.cmd") -or
                    $commandLine.Contains("hook.exe") -or
                    $commandLine.Contains("remote-debugging-port=$DebugPort") -or
                    ($HookRoot -and $commandLine.Contains($HookRoot))
                )

            if ($safe) {
                $stopped += @(Stop-PidSet -ProcessIds @($listenerProcessId) -Reason "safe new smoke listener on port $port")
            }
        }
    }

    return @($stopped)
}

function Wait-RuntimeLogContains {
    param(
        [string]$RuntimeLogDir,
        [string]$Needle,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $runtimeLog = Get-ChildItem -LiteralPath $RuntimeLogDir -Filter "hook-runtime.log" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($runtimeLog) {
            $tail = @(Get-LogTail -Path $runtimeLog.FullName -Tail 200)
            if (($tail -join "`n").Contains($Needle)) {
                return $runtimeLog.FullName
            }
        }
        Start-Sleep -Milliseconds 300
    }

    throw "Runtime log did not contain '$Needle' within $TimeoutSec seconds"
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptRoot
$hookRoot = Join-Path $repoRoot "Hook"
$teaRoot = Join-Path $repoRoot "Tea"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = "$timestamp-$(([guid]::NewGuid()).ToString("N").Substring(0, 8))"
$artifactRoot = Join-Path $repoRoot ".tmp\tea-smoke\hook-tea-tauri-ui-real-$runId"
$storePath = Join-Path $artifactRoot "tea-smoke.sqlite"
$runtimeLogDir = Join-Path $artifactRoot "runtime-log"
$webview2UserDataDir = Join-Path $artifactRoot "webview2-user-data"
$teaStdoutPath = Join-Path $artifactRoot "tea-daemon.stdout.log"
$teaStderrPath = Join-Path $artifactRoot "tea-daemon.stderr.log"
$tauriStdoutPath = Join-Path $artifactRoot "tauri-dev.stdout.log"
$tauriStderrPath = Join-Path $artifactRoot "tauri-dev.stderr.log"
$tauriCmdPath = Join-Path $artifactRoot "run-tauri-dev.cmd"
$tauriConfigPath = Join-Path $artifactRoot "tauri-smoke.conf.json"
$uiSmokeScript = Join-Path $artifactRoot "tauri-ui-smoke.mjs"
$resultPath = Join-Path $artifactRoot "hook-tea-tauri-ui-real-result.json"
$summaryPath = Join-Path $artifactRoot "summary.json"

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeLogDir | Out-Null
New-Item -ItemType Directory -Force -Path $webview2UserDataDir | Out-Null

if ($TeaPort -eq 0) {
    $TeaPort = Get-FreeTcpPort
}
if ($HookPort -eq 0) {
    do {
        $HookPort = Get-FreeTcpPort
    } while ($HookPort -eq $TeaPort)
}
if ($DebugPort -eq 0) {
    do {
        $DebugPort = Get-FreeTcpPort
    } while ($DebugPort -eq $TeaPort -or $DebugPort -eq $HookPort)
}
if ($TeaPort -eq $HookPort -or $TeaPort -eq $DebugPort -or $HookPort -eq $DebugPort) {
    throw "TeaPort, HookPort, and DebugPort must be distinct"
}

$baseUrl = "http://127.0.0.1:$TeaPort"
$hookUrl = "http://127.0.0.1:$HookPort"
$cdpUrl = "http://127.0.0.1:$DebugPort"
$teaManifest = Join-Path $repoRoot "Tea\Cargo.toml"
$teaExe = Join-Path $repoRoot "Tea\target\debug\tea-daemon.exe"

$baselineTeaListeners = @(Get-PortListeners -Port $TeaPort)
$baselineHookListeners = @(Get-PortListeners -Port $HookPort)
$baselineDebugListeners = @(Get-PortListeners -Port $DebugPort)
$baselineListeners = @(
    $baselineTeaListeners
    $baselineHookListeners
    $baselineDebugListeners
)
$baselineListenerPids = @($baselineListeners | ForEach-Object { [int]$_.pid } | Sort-Object -Unique)

$daemon = $null
$tauriCommand = $null
$daemonPid = 0
$tauriCommandPid = 0
$tauriCommandTree = @()
$smokeSucceeded = $false
$teaApiVerified = $false
$runtimeLogContainsTicket = $false
$runtimeLogPath = $null
$cdpVersion = $null
$tauriCommandTreeStopped = $false
$hookStopped = $false
$webviewDebugStopped = $false

$summary = [ordered]@{
    status = "running"
    run_id = $runId
    artifact_root = $artifactRoot
    base_url = $baseUrl
    hook_url = "$hookUrl/"
    cdp_url = $cdpUrl
    debug_port = $DebugPort
    ticket_id = $null
    ui_smoke_script = $uiSmokeScript
    tauri_config_path = $tauriConfigPath
    result_path = $resultPath
    store_path = $storePath
    runtime_log_dir = $runtimeLogDir
    webview2_user_data_dir = $webview2UserDataDir
    runtime_log_path = $null
    tea_stdout_path = $teaStdoutPath
    tea_stderr_path = $teaStderrPath
    tauri_stdout_path = $tauriStdoutPath
    tauri_stderr_path = $tauriStderrPath
    daemon_pid = $null
    tauri_command_pid = $null
    native_tauri_runtime = $false
    frontend_ticket_recorded = $false
    runtime_log_contains_ticket = $false
    tea_api_verified = $false
    event_count = $null
    labels = @()
    cdp_version = $null
    baseline_tea_listener_count = $baselineTeaListeners.Count
    baseline_hook_listener_count = $baselineHookListeners.Count
    baseline_debug_listener_count = $baselineDebugListeners.Count
    preexisting_tea_listeners = @()
    preexisting_hook_listeners = @()
    preexisting_debug_listeners = @()
    preexisting_listener_count = 0
    keep_artifacts = [bool]$KeepArtifacts
    cleanup_phase = "not_started"
    cleanup_detail = "not_started"
    cleanup_checked_at = $null
    cleanup_error = $null
    daemon_stopped = $false
    tauri_command_tree_stopped = $false
    hook_stopped = $false
    webview_debug_stopped = $false
    port_listener_count_after_stop = $null
    hook_port_listener_count_after_stop = $null
    debug_port_listener_count_after_stop = $null
    listeners_after_stop = @()
    hook_listeners_after_stop = @()
    debug_listeners_after_stop = @()
    store_files_before_cleanup = @()
    store_file_count_before_cleanup = $null
    store_total_size_before_cleanup_bytes = $null
    store_files_after_cleanup = @()
    store_file_count_after_cleanup = $null
    store_preserved = $null
    webview2_user_data_removed = $false
    webview2_user_data_exists_after_cleanup = $null
    runtime_log_tail = @()
    stdout_tail = @()
    stderr_tail = @()
    tauri_stdout_tail = @()
    tauri_stderr_tail = @()
    started_at = (Get-Date).ToString("o")
    finished_at = $null
    error = $null
}

Write-SmokeSummary -Summary $summary -Path $summaryPath
Assert-NoPreexistingPortListeners -Summary $summary -SummaryPath $summaryPath -TeaListeners $baselineTeaListeners -HookListeners $baselineHookListeners -DebugListeners $baselineDebugListeners

$tauriConfig = [ordered]@{
    build = [ordered]@{
        beforeDevCommand = [ordered]@{
            script = "cmd /c node scripts\serve-static.mjs --host 127.0.0.1 --port $HookPort --root .output/public"
            cwd = $hookRoot
            wait = $false
        }
        devUrl = $hookUrl
    }
}
$tauriConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $tauriConfigPath -Encoding UTF8

@(
    "@echo off",
    "setlocal",
    "set `"HOOK_LOG_DIR=$runtimeLogDir`"",
    "set `"HOOK_INITIAL_UI_MODE=canvas`"",
    "set `"HOOK_ENABLE_ARTLOOM=0`"",
    "set `"HOOK_TEA_INTAKE_ENABLED=1`"",
    "set `"HOOK_TEA_BASE_URL=$baseUrl`"",
    "set `"HOOK_TEA_AUTH_TOKEN=$AuthToken`"",
    "set `"HOOK_TEA_SOURCE=hook-desktop`"",
    "set `"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=$DebugPort --remote-allow-origins=*`"",
    "set `"WEBVIEW2_USER_DATA_FOLDER=$webview2UserDataDir`"",
    "cd /d `"$hookRoot`"",
    "call node_modules\.bin\tauri.cmd dev --no-watch --config `"$tauriConfigPath`""
) | Set-Content -LiteralPath $tauriCmdPath -Encoding ASCII

@'
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";

const require = createRequire(`${process.cwd()}\\package.json`);
const { chromium } = require("playwright");

const cdpUrl = process.env.HOOK_TEA_TAURI_CDP_URL;
const resultPath = process.env.HOOK_TEA_TAURI_RESULT_PATH;
const timeoutMs = Number(process.env.HOOK_TEA_TAURI_TIMEOUT_MS || "60000");

if (!cdpUrl || !resultPath) {
  throw new Error("HOOK_TEA_TAURI_CDP_URL and HOOK_TEA_TAURI_RESULT_PATH are required");
}

const consoleMessages = [];
const pageErrors = [];
const pageStates = [];
const seenPages = new Set();

const writeResult = async (result) => {
  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const trackPage = (page) => {
  if (seenPages.has(page)) return;
  seenPages.add(page);
  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error instanceof Error ? error.message : String(error));
  });
};

const attachedLocatorOnAnyPage = async (browser, selector, timeout) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const page of pages) {
      if (page.isClosed()) continue;
      trackPage(page);
      pageStates.push({
        at: new Date().toISOString(),
        url: page.url(),
        title: await page.title().catch(() => ""),
      });
      try {
        const locator = page.locator(selector);
        await locator.waitFor({ state: "attached", timeout: 500 });
        return { page, locator };
      } catch {
        // Keep polling pages until the real WebView has mounted the Hook UI.
      }
    }
    await delay(300);
  }
  throw new Error(`Timed out waiting for attached selector ${selector}`);
};

let browser = null;
try {
  browser = await chromium.connectOverCDP(cdpUrl);
  for (const context of browser.contexts()) {
    context.on("page", trackPage);
    for (const page of context.pages()) {
      trackPage(page);
    }
  }

  const { page, locator: button } = await attachedLocatorOnAnyPage(
    browser,
    '[data-testid="tea-ticket-button"]',
    timeoutMs,
  );
  const output = page.locator('[data-testid="tea-ticket-output"]');
  const nativeTauriRuntime = await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__));
  if (!nativeTauriRuntime) {
    throw new Error("Hook WebView did not expose the native Tauri runtime");
  }

  await button.evaluate((element) => element.click());
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="tea-ticket-output"]')?.textContent || "";
    return /[0-9a-f-]{36}/i.test(text);
  }, { timeout: timeoutMs });

  const outputText = await output.evaluate((element) => element.textContent || "");
  const ticketId = outputText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || null;
  if (!ticketId) {
    throw new Error(`Could not extract ticket id from output: ${outputText}`);
  }

  await writeResult({
    status: "passed",
    ticketId,
    outputText,
    native_tauri_runtime: nativeTauriRuntime,
    frontendTicketRecorded: outputText.includes(ticketId),
    pageUrl: page.url(),
    pageTitle: await page.title().catch(() => ""),
    pageStates,
    consoleMessages,
    pageErrors,
  });
} catch (error) {
  await writeResult({
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    pageStates,
    consoleMessages,
    pageErrors,
  });
  throw error;
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }
}
'@ | Set-Content -LiteralPath $uiSmokeScript -Encoding UTF8

$oldEnv = @{
    TEA_BIND_ADDR = $env:TEA_BIND_ADDR
    TEA_AUTH_TOKEN = $env:TEA_AUTH_TOKEN
    TEA_STORE_PATH = $env:TEA_STORE_PATH
    TEA_LOOM_BASE_URL = $env:TEA_LOOM_BASE_URL
    TEA_LOOM_AUTH_TOKEN = $env:TEA_LOOM_AUTH_TOKEN
    HOOK_TEA_TAURI_CDP_URL = $env:HOOK_TEA_TAURI_CDP_URL
    HOOK_TEA_TAURI_RESULT_PATH = $env:HOOK_TEA_TAURI_RESULT_PATH
    HOOK_TEA_TAURI_TIMEOUT_MS = $env:HOOK_TEA_TAURI_TIMEOUT_MS
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

    Write-Host ">> starting tea-daemon at $baseUrl"
    $daemon = Start-Process -FilePath $teaExe `
        -WorkingDirectory $teaRoot `
        -RedirectStandardOutput $teaStdoutPath `
        -RedirectStandardError $teaStderrPath `
        -WindowStyle Hidden `
        -PassThru
    $daemonPid = $daemon.Id
    $summary["daemon_pid"] = $daemonPid
    Write-SmokeSummary -Summary $summary -Path $summaryPath

    Wait-TeaHealth -BaseUrl $baseUrl -Process $daemon -TimeoutSec $TimeoutSec

    Write-Host ">> starting Hook Tauri dev with WebView2 CDP at $cdpUrl"
    $tauriStartedAt = Get-Date
    $tauriCommand = Start-Process -FilePath "cmd.exe" `
        -ArgumentList @("/d", "/s", "/c", "`"$tauriCmdPath`"") `
        -WorkingDirectory $hookRoot `
        -RedirectStandardOutput $tauriStdoutPath `
        -RedirectStandardError $tauriStderrPath `
        -WindowStyle Hidden `
        -PassThru
    $tauriCommandPid = $tauriCommand.Id
    $summary["tauri_command_pid"] = $tauriCommandPid
    Write-SmokeSummary -Summary $summary -Path $summaryPath

    $cdpVersion = Wait-CdpAvailable -Port $DebugPort -Process $tauriCommand -TimeoutSec $TimeoutSec
    $summary["cdp_version"] = $cdpVersion
    Write-SmokeSummary -Summary $summary -Path $summaryPath

    $env:HOOK_TEA_TAURI_CDP_URL = $cdpUrl
    $env:HOOK_TEA_TAURI_RESULT_PATH = $resultPath
    $env:HOOK_TEA_TAURI_TIMEOUT_MS = [string]($TimeoutSec * 1000)

    Invoke-Checked -FilePath "node" -WorkingDirectory $hookRoot -Arguments @($uiSmokeScript)

    if (!(Test-Path -LiteralPath $resultPath)) {
        throw "Hook Tea Tauri UI smoke result was not written at $resultPath"
    }

    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    if ($result.status -ne "passed") {
        throw "Hook Tea Tauri UI smoke result status was $($result.status): $($result.error)"
    }
    if ([string]::IsNullOrWhiteSpace($result.ticketId)) {
        throw "Hook Tea Tauri UI smoke result did not contain ticketId"
    }
    if ($result.native_tauri_runtime -ne $true) {
        throw "Hook Tea Tauri UI smoke did not confirm native_tauri_runtime"
    }
    if ($result.frontendTicketRecorded -ne $true) {
        throw "Hook Tea Tauri UI smoke did not confirm frontend_ticket_recorded"
    }

    $ticketId = $result.ticketId
    $runtimeLogPath = Wait-RuntimeLogContains -RuntimeLogDir $runtimeLogDir -Needle "tea_ticket_created :: id=$ticketId" -TimeoutSec 15
    $runtimeLogContainsTicket = $true

    $headers = @{ Authorization = "Bearer $AuthToken" }
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
    if (!$ticket.description.Contains("Hook desktop ticket request (panel)")) {
        throw "ticket description does not contain Hook panel ticket text"
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
    if (!$markdown.Contains("Hook desktop ticket request (panel)")) {
        throw "markdown export does not contain Hook panel ticket text"
    }
    if (!$markdown.Contains("TicketCreated")) {
        throw "markdown export does not contain TicketCreated"
    }

    $teaApiVerified = $true
    $smokeSucceeded = $true
    $summary["status"] = "validated_pending_cleanup"
    $summary["ticket_id"] = $ticketId
    $summary["native_tauri_runtime"] = [bool]$result.native_tauri_runtime
    $summary["frontend_ticket_recorded"] = [bool]$result.frontendTicketRecorded
    $summary["runtime_log_contains_ticket"] = $runtimeLogContainsTicket
    $summary["runtime_log_path"] = $runtimeLogPath
    $summary["tea_api_verified"] = $teaApiVerified
    $summary["event_count"] = @($events).Count
    $summary["labels"] = $labels
    Write-SmokeSummary -Summary $summary -Path $summaryPath

    Write-Host "Hook native Tauri UI -> Tea real smoke validated; cleanup still pending"
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
    $stoppedProcesses = @()
    $listenersAfterStop = @()
    $hookListenersAfterStop = @()
    $debugListenersAfterStop = @()
    $storeFilesBeforeCleanup = @()
    $storeTotalSizeBeforeCleanupBytes = $null
    $storeFilesAfterCleanup = @()
    $webview2UserDataRemoved = $false

    try {
        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "stopping_tauri" -Detail "stopping_tauri_command_tree"
        if ($tauriCommandPid -gt 0) {
            $tauriCommandTree = @(Get-ProcessTreeIds -RootIds @($tauriCommandPid))
            $stoppedProcesses += @(Stop-PidSet -ProcessIds $tauriCommandTree -Reason "Tauri dev command tree")
        }

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "stopping_tauri" -Detail "stopping_hook"
        $newHook = @(Get-NewHookProcesses -HookRoot $hookRoot -StartedAfter $tauriStartedAt)
        if ($newHook.Count -gt 0) {
            $stoppedProcesses += @(Stop-PidSet -ProcessIds @($newHook | ForEach-Object { [int]$_.processId }) -Reason "new Hook hook.exe")
        }

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "stopping_tauri" -Detail "stopping_webview_debug"
        $newDebugWebViews = @(Get-NewWebViewDebugProcesses -Port $DebugPort -StartedAfter $tauriStartedAt)
        if ($newDebugWebViews.Count -gt 0) {
            $stoppedProcesses += @(Stop-PidSet -ProcessIds @($newDebugWebViews | ForEach-Object { [int]$_.processId }) -Reason "new WebView2 debug process")
        }

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "stopping_tauri" -Detail "stopping_safe_port_listeners"
        $stoppedProcesses += @(Stop-SafeNewPortListeners -Ports @($HookPort, $DebugPort) -BaselinePids $baselineListenerPids -StartedAfter $tauriStartedAt -HookRoot $hookRoot -DebugPort $DebugPort)

        if ($tauriCommand -ne $null) {
            $tauriCommand.Dispose()
            $tauriCommand = $null
        }

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "stopping_tea_daemon"
        [void](Stop-SmokeProcess -ProcessId $daemonPid -Name "tea-daemon" -TimeoutMs 5000)
        if ($daemon -ne $null) {
            $daemon.Dispose()
            $daemon = $null
        }

        Start-Sleep -Seconds 2

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "collecting_evidence" -Detail "collecting_store"
        $storeFilesBeforeCleanup = @(Get-StoreFiles -StorePath $storePath)
        $storeTotalSizeBeforeCleanupBytes = 0
        foreach ($storeFile in $storeFilesBeforeCleanup) {
            $storeTotalSizeBeforeCleanupBytes += $storeFile.length
        }

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "collecting_evidence" -Detail "collecting_process_state"
        $tauriTreeRemaining = @()
        if ($tauriCommandTree.Count -gt 0) {
            $tauriTreeRemaining = @($tauriCommandTree | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        }
        $remainingHook = @(Get-NewHookProcesses -HookRoot $hookRoot -StartedAfter $tauriStartedAt)
        $remainingDebugWebViews = @(Get-NewWebViewDebugProcesses -Port $DebugPort -StartedAfter $tauriStartedAt)
        $daemonStopped = [bool]($daemonPid -le 0 -or $null -eq (Get-Process -Id $daemonPid -ErrorAction SilentlyContinue))
        $tauriCommandTreeStopped = [bool]($tauriTreeRemaining.Count -eq 0)
        $hookStopped = [bool]($remainingHook.Count -eq 0)
        $webviewDebugStopped = [bool]($remainingDebugWebViews.Count -eq 0)

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "collecting_evidence" -Detail "collecting_listeners"
        $listenersAfterStop = @(Get-PortListeners -Port $TeaPort)
        $hookListenersAfterStop = @(Get-PortListeners -Port $HookPort)
        $debugListenersAfterStop = @(Get-PortListeners -Port $DebugPort)

        if (!$KeepArtifacts) {
            Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "removing_store"
            Remove-Item -LiteralPath $storePath -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath "$storePath-shm" -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath "$storePath-wal" -Force -ErrorAction SilentlyContinue
            $webview2UserDataRemoved = Remove-SmokeDirectoryInsideArtifact -Path $webview2UserDataDir -ArtifactRoot $artifactRoot
        }
        $storeFilesAfterCleanup = @(Get-StoreFiles -StorePath $storePath)

        if ($smokeSucceeded -and (
            !$daemonStopped -or
            !$tauriCommandTreeStopped -or
            !$hookStopped -or
            !$webviewDebugStopped -or
            $listenersAfterStop.Count -ne 0 -or
            $hookListenersAfterStop.Count -ne 0 -or
            $debugListenersAfterStop.Count -ne 0
        )) {
            $cleanupFailure = "cleanup failed: daemon_stopped=$daemonStopped tauri_command_tree_stopped=$tauriCommandTreeStopped hook_stopped=$hookStopped webview_debug_stopped=$webviewDebugStopped port_listener_count_after_stop=$($listenersAfterStop.Count) hook_port_listener_count_after_stop=$($hookListenersAfterStop.Count) debug_port_listener_count_after_stop=$($debugListenersAfterStop.Count)"
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
        $summary["tauri_command_tree_stopped"] = $tauriCommandTreeStopped
        $summary["hook_stopped"] = $hookStopped
        $summary["webview_debug_stopped"] = $webviewDebugStopped
        $summary["port_listener_count_after_stop"] = $listenersAfterStop.Count
        $summary["hook_port_listener_count_after_stop"] = $hookListenersAfterStop.Count
        $summary["debug_port_listener_count_after_stop"] = $debugListenersAfterStop.Count
        $summary["listeners_after_stop"] = $listenersAfterStop
        $summary["hook_listeners_after_stop"] = $hookListenersAfterStop
        $summary["debug_listeners_after_stop"] = $debugListenersAfterStop
        $summary["store_files_before_cleanup"] = $storeFilesBeforeCleanup
        $summary["store_file_count_before_cleanup"] = $storeFilesBeforeCleanup.Count
        $summary["store_total_size_before_cleanup_bytes"] = $storeTotalSizeBeforeCleanupBytes
        $summary["store_files_after_cleanup"] = $storeFilesAfterCleanup
        $summary["store_file_count_after_cleanup"] = $storeFilesAfterCleanup.Count
        $summary["store_preserved"] = [bool](Test-Path -LiteralPath $storePath)
        $summary["webview2_user_data_removed"] = $webview2UserDataRemoved
        $summary["webview2_user_data_exists_after_cleanup"] = [bool](Test-Path -LiteralPath $webview2UserDataDir)
        if ($runtimeLogPath -eq $null) {
            $runtimeLog = Get-ChildItem -LiteralPath $runtimeLogDir -Filter "hook-runtime.log" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($runtimeLog) {
                $runtimeLogPath = $runtimeLog.FullName
                $summary["runtime_log_path"] = $runtimeLogPath
            }
        }
        $summary["runtime_log_tail"] = if ($runtimeLogPath) { @(Get-LogTail -Path $runtimeLogPath -Tail 120) } else { @() }
        $summary["stdout_tail"] = @(Get-LogTail -Path $teaStdoutPath)
        $summary["stderr_tail"] = @(Get-LogTail -Path $teaStderrPath)
        $summary["tauri_stdout_tail"] = @(Get-LogTail -Path $tauriStdoutPath -Tail 160)
        $summary["tauri_stderr_tail"] = @(Get-LogTail -Path $tauriStderrPath -Tail 160)
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
