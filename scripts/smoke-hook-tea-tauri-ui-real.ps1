param(
    [int]$TeaPort = 0,
    [int]$HookPort = 0,
    [int]$DebugPort = 0,
    [string]$AuthToken = "hook-tea-tauri-ui-smoke-token",
    [int]$TimeoutSec = 120,
    [switch]$KeepArtifacts
)

$ErrorActionPreference = "Stop"


# Dot-source lexical owners so cleanup, exit, and script-scope behavior stay unchanged.
$smokeOwnersDir = Join-Path $PSScriptRoot "smoke-hook-tea-tauri-ui-real"
. (Join-Path $smokeOwnersDir "process-artifact.ps1")
. (Join-Path $smokeOwnersDir "command-readiness.ps1")
. (Join-Path $smokeOwnersDir "process-cleanup.ps1")

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
    "set `"HOOK_ENABLE_LOOM_HOOK=0`"",
    "set `"HOOK_TEA_INTAKE_ENABLED=1`"",
    "set `"HOOK_TEA_BASE_URL=$baseUrl`"",
    "set `"HOOK_TEA_AUTH_TOKEN=$AuthToken`"",
    "set `"HOOK_TEA_SOURCE=hook-desktop`"",
    "set `"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=$DebugPort --remote-allow-origins=*`"",
    "set `"WEBVIEW2_USER_DATA_FOLDER=$webview2UserDataDir`"",
    "cd /d `"$hookRoot`"",
    "call node_modules\.bin\tauri.cmd dev --no-watch --config `"$tauriConfigPath`""
) | Set-Content -LiteralPath $tauriCmdPath -Encoding ASCII


. (Join-Path $smokeOwnersDir "write-tauri-ui-probe.ps1")

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
