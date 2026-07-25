param(
    [int]$Port = 0,
    [string]$AuthToken = "hook-tea-smoke-token",
    [int]$TimeoutSec = 45,
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
        [int]$Tail = 40
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

function Write-SmokeSummary {
    param(
        $Summary,
        [string]$Path
    )

    $Summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
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

function Set-SmokeCleanupDetail {
    param(
        $Summary,
        [string]$Path,
        [string]$Detail
    )

    $Summary["cleanup_detail"] = $Detail
    Write-SmokeSummary -Summary $Summary -Path $Path
}

function Stop-SmokeDaemon {
    param(
        [int]$ProcessId,
        [int]$TimeoutMs = 5000
    )

    if ($ProcessId -le 0) {
        return $true
    }

    if ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        return $true
    }

    Write-Host ">> stopping tea-daemon pid=$ProcessId"
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
    $exitCode = 0
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
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runId = "$timestamp-$(([guid]::NewGuid()).ToString("N").Substring(0, 8))"
$artifactRoot = Join-Path $repoRoot ".tmp\tea-smoke\hook-tea-real-$runId"
$storePath = Join-Path $artifactRoot "tea-smoke.sqlite"
$stdoutPath = Join-Path $artifactRoot "tea-daemon.stdout.log"
$stderrPath = Join-Path $artifactRoot "tea-daemon.stderr.log"
$resultPath = Join-Path $artifactRoot "hook-tea-real-result.json"
$summaryPath = Join-Path $artifactRoot "summary.json"

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null

if ($Port -eq 0) {
    $Port = Get-FreeTcpPort
}

$baseUrl = "http://127.0.0.1:$Port"
$teaManifest = Join-Path $repoRoot "Tea\Cargo.toml"
$hookManifest = Join-Path $repoRoot "Hook\src-tauri\Cargo.toml"
$teaExe = Join-Path $repoRoot "Tea\target\debug\tea-daemon.exe"

$daemon = $null
$daemonPid = 0
$daemonExitCode = $null
$smokeSucceeded = $false
$summary = [ordered]@{
    status = "running"
    run_id = $runId
    artifact_root = $artifactRoot
    base_url = $baseUrl
    ticket_id = $null
    store_path = $storePath
    result_path = $resultPath
    stdout_path = $stdoutPath
    stderr_path = $stderrPath
    labels = @()
    event_count = $null
    daemon_pid = $null
    daemon_exit_code = $null
    keep_artifacts = [bool]$KeepArtifacts
    cleanup_phase = "not_started"
    cleanup_detail = "not_started"
    cleanup_checked_at = $null
    cleanup_error = $null
    daemon_stopped = $false
    port_listener_count_after_stop = $null
    listeners_after_stop = @()
    store_created_before_cleanup = $false
    store_size_before_cleanup_bytes = $null
    store_files_before_cleanup = @()
    store_file_count_before_cleanup = $null
    store_total_size_before_cleanup_bytes = $null
    store_preserved = $null
    store_files_after_cleanup = @()
    store_file_count_after_cleanup = $null
    stdout_tail = @()
    stderr_tail = @()
    started_at = (Get-Date).ToString("o")
    finished_at = $null
    error = $null
}

Write-SmokeSummary -Summary $summary -Path $summaryPath

$oldTeaBindAddr = $env:TEA_BIND_ADDR
$oldTeaAuthToken = $env:TEA_AUTH_TOKEN
$oldTeaStorePath = $env:TEA_STORE_PATH
$oldRealBaseUrl = $env:TEA_REAL_SMOKE_BASE_URL
$oldRealAuthToken = $env:TEA_REAL_SMOKE_AUTH_TOKEN
$oldRealResultPath = $env:TEA_REAL_SMOKE_RESULT_PATH

try {
    Invoke-Checked -FilePath "cargo" -WorkingDirectory $repoRoot -Arguments @(
        "build",
        "--manifest-path", $teaManifest,
        "-p", "tea-daemon"
    )

    if (!(Test-Path -LiteralPath $teaExe)) {
        throw "tea-daemon executable was not built at $teaExe"
    }

    $env:TEA_BIND_ADDR = "127.0.0.1:$Port"
    $env:TEA_AUTH_TOKEN = $AuthToken
    $env:TEA_STORE_PATH = $storePath

    Write-Host ">> starting tea-daemon at $baseUrl"
    $daemon = Start-Process -FilePath $teaExe `
        -WorkingDirectory (Join-Path $repoRoot "Tea") `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    $summary["daemon_pid"] = $daemon.Id
    $daemonPid = $daemon.Id

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
        if ($daemon.HasExited) {
            $daemon.Refresh()
            $earlyExitCode = $null
            try {
                $earlyExitCode = $daemon.ExitCode
            }
            catch {
                $earlyExitCode = $null
            }
            $daemonExitCode = $earlyExitCode
            throw "tea-daemon exited early with code $earlyExitCode. stdout=$stdoutPath stderr=$stderrPath"
        }

        try {
            $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get -TimeoutSec 2
            if ($health.status -eq "ok") {
                $healthy = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 300
        }
    }
    if (!$healthy) {
        throw "tea-daemon did not become healthy at $baseUrl within $TimeoutSec seconds"
    }

    $env:TEA_REAL_SMOKE_BASE_URL = $baseUrl
    $env:TEA_REAL_SMOKE_AUTH_TOKEN = $AuthToken
    $env:TEA_REAL_SMOKE_RESULT_PATH = $resultPath

    Invoke-Checked -FilePath "cargo" -WorkingDirectory $repoRoot -Arguments @(
        "test",
        "--manifest-path", $hookManifest,
        "--test", "tea_real_daemon_smoke",
        "--",
        "--ignored",
        "--nocapture"
    )

    if (!(Test-Path -LiteralPath $resultPath)) {
        throw "real smoke result was not written at $resultPath"
    }

    $headers = @{ Authorization = "Bearer $AuthToken" }
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    $ticketId = $result.ticket.id
    if ([string]::IsNullOrWhiteSpace($ticketId)) {
        throw "result JSON does not contain ticket.id"
    }

    $ticket = Invoke-RestMethod -Uri "$baseUrl/v1/tickets/$ticketId" -Headers $headers -Method Get -TimeoutSec 5
    $events = Invoke-RestMethod -Uri "$baseUrl/v1/tickets/$ticketId/events" -Headers $headers -Method Get -TimeoutSec 5
    $markdown = Invoke-TeaText -Uri "$baseUrl/v1/tickets/$ticketId/export/markdown" -AuthToken $AuthToken

    if ($ticket.source -ne "hook") {
        throw "expected source=hook, got $($ticket.source)"
    }
    if ($ticket.approval_policy -ne "plan_only") {
        throw "expected approval_policy=plan_only, got $($ticket.approval_policy)"
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
    if (!$markdown.Contains("TicketCreated")) {
        throw "markdown export does not contain TicketCreated"
    }

    $summary["status"] = "validated_pending_cleanup"
    $summary["ticket_id"] = $ticketId
    $summary["labels"] = $labels
    $summary["event_count"] = @($events).Count
    $smokeSucceeded = $true

    Write-Host "Hook -> Tea real smoke validated; cleanup still pending"
    Write-Host "ticket_id=$ticketId"
    Write-Host "summary=$summaryPath"
}
catch {
    $summary["status"] = "failed"
    $summary["error"] = $_.Exception.Message
    throw
}
finally {
    $storeCreatedBeforeCleanup = $false
    $storeSizeBeforeCleanupBytes = $null
    $storeFilesBeforeCleanup = @()
    $storeTotalSizeBeforeCleanupBytes = $null
    $storeFilesAfterCleanup = @()
    $listenersAfterStop = @()
    $daemonStopped = $false
    $cleanupFailure = $null

    try {
        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "stopping_daemon"
        [void](Stop-SmokeDaemon -ProcessId $daemonPid -TimeoutMs 5000)
        if ($daemon -ne $null) {
            $daemon.Dispose()
            $daemon = $null
        }

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "collecting_evidence" -Detail "collecting_store"
        $storeCreatedBeforeCleanup = Test-Path -LiteralPath $storePath
        if ($storeCreatedBeforeCleanup) {
            $storeSizeBeforeCleanupBytes = (Get-Item -LiteralPath $storePath).Length
        }
        $storeFilesBeforeCleanup = @(Get-StoreFiles -StorePath $storePath)
        $storeTotalSizeBeforeCleanupBytes = 0
        foreach ($storeFile in $storeFilesBeforeCleanup) {
            $storeTotalSizeBeforeCleanupBytes += $storeFile.length
        }
        Set-SmokeCleanupDetail -Summary $summary -Path $summaryPath -Detail "collecting_listeners"
        $listenersAfterStop = @(Get-PortListeners -Port $Port)
        Set-SmokeCleanupDetail -Summary $summary -Path $summaryPath -Detail "collecting_process_state"
        $daemonStopped = [bool]($daemonPid -le 0 -or $null -eq (Get-Process -Id $daemonPid -ErrorAction SilentlyContinue))

        $env:TEA_BIND_ADDR = $oldTeaBindAddr
        $env:TEA_AUTH_TOKEN = $oldTeaAuthToken
        $env:TEA_STORE_PATH = $oldTeaStorePath
        $env:TEA_REAL_SMOKE_BASE_URL = $oldRealBaseUrl
        $env:TEA_REAL_SMOKE_AUTH_TOKEN = $oldRealAuthToken
        $env:TEA_REAL_SMOKE_RESULT_PATH = $oldRealResultPath

        if (!$KeepArtifacts) {
            Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "removing_store"
            Remove-Item -LiteralPath $storePath -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath "$storePath-shm" -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath "$storePath-wal" -Force -ErrorAction SilentlyContinue
        }
        $storeFilesAfterCleanup = @(Get-StoreFiles -StorePath $storePath)

        if ($smokeSucceeded -and (!$daemonStopped -or $listenersAfterStop.Count -ne 0)) {
            $cleanupFailure = "tea-daemon cleanup failed: daemon_stopped=$daemonStopped port_listener_count_after_stop=$($listenersAfterStop.Count)"
        }
    }
    catch {
        $cleanupFailure = $_.Exception.Message
    }
    finally {
        $env:TEA_BIND_ADDR = $oldTeaBindAddr
        $env:TEA_AUTH_TOKEN = $oldTeaAuthToken
        $env:TEA_STORE_PATH = $oldTeaStorePath
        $env:TEA_REAL_SMOKE_BASE_URL = $oldRealBaseUrl
        $env:TEA_REAL_SMOKE_AUTH_TOKEN = $oldRealAuthToken
        $env:TEA_REAL_SMOKE_RESULT_PATH = $oldRealResultPath

        Set-SmokeCleanupPhase -Summary $summary -Path $summaryPath -Phase "writing_final_summary" -Detail "collecting_log_tails"
        $summary["cleanup_checked_at"] = (Get-Date).ToString("o")
        $summary["daemon_stopped"] = $daemonStopped
        $summary["daemon_exit_code"] = $daemonExitCode
        $summary["port_listener_count_after_stop"] = $listenersAfterStop.Count
        $summary["listeners_after_stop"] = $listenersAfterStop
        $summary["store_created_before_cleanup"] = $storeCreatedBeforeCleanup
        $summary["store_size_before_cleanup_bytes"] = $storeSizeBeforeCleanupBytes
        $summary["store_files_before_cleanup"] = $storeFilesBeforeCleanup
        $summary["store_file_count_before_cleanup"] = $storeFilesBeforeCleanup.Count
        $summary["store_total_size_before_cleanup_bytes"] = $storeTotalSizeBeforeCleanupBytes
        $summary["store_preserved"] = [bool](Test-Path -LiteralPath $storePath)
        $summary["store_files_after_cleanup"] = $storeFilesAfterCleanup
        $summary["store_file_count_after_cleanup"] = $storeFilesAfterCleanup.Count
        $summary["stdout_tail"] = @(Get-LogTail -Path $stdoutPath)
        $summary["stderr_tail"] = @(Get-LogTail -Path $stderrPath)
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
