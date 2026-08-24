# Owns native browser probes, candidate lifecycle, clean exit, and process-tree sampling.

function Invoke-NativeProbe {
    param(
        [Parameter(Mandatory = $true)][int]$DebugPort,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Marker,
        [switch]$PersistSettings,
        [switch]$RequestExit,
        [switch]$SurfaceDashboard
    )

    $resultPath = Join-Path $resolvedArtifactRoot "$Name.json"
    $keys = @(
        "HOOK_ACCEPTANCE_HOOK_ROOT",
        "HOOK_ACCEPTANCE_CDP_URL",
        "HOOK_ACCEPTANCE_RESULT_PATH",
        "HOOK_ACCEPTANCE_MARKER",
        "HOOK_ACCEPTANCE_MODE",
        "HOOK_ACCEPTANCE_PERSIST_SETTINGS",
        "HOOK_ACCEPTANCE_TIMEOUT_MS"
    )
    $oldValues = @{}
    foreach ($key in $keys) {
        $oldValues[$key] = [Environment]::GetEnvironmentVariable($key)
    }

    try {
        $env:HOOK_ACCEPTANCE_HOOK_ROOT = $hookRoot
        $env:HOOK_ACCEPTANCE_CDP_URL = "http://127.0.0.1:$DebugPort"
        $env:HOOK_ACCEPTANCE_RESULT_PATH = $resultPath
        $env:HOOK_ACCEPTANCE_MARKER = $Marker
        $env:HOOK_ACCEPTANCE_MODE = if ($RequestExit) {
            "exit"
        }
        elseif ($SurfaceDashboard) {
            "surface"
        }
        else {
            "probe"
        }
        $env:HOOK_ACCEPTANCE_PERSIST_SETTINGS = if ($PersistSettings) { "1" } else { "0" }
        $env:HOOK_ACCEPTANCE_TIMEOUT_MS = [string]($StartupTimeoutSeconds * 1000)
        & node $probeScriptPath
        $nodeExitCode = $LASTEXITCODE
    }
    finally {
        foreach ($key in $keys) {
            $oldValue = $oldValues[$key]
            if ($null -eq $oldValue) {
                Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue
            }
            else {
                Set-Item -Path "Env:$key" -Value $oldValue
            }
        }
    }

    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
        throw "native probe did not write $resultPath; nodeExitCode=$nodeExitCode"
    }
    $result = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($RequestExit) {
        if ($result.status -ne "exit_requested" -or $result.requested -ne $true) {
            throw "native exit probe failed: $($result | ConvertTo-Json -Depth 8 -Compress)"
        }
    }
    elseif ($nodeExitCode -ne 0 -or $result.status -ne "passed" -or $result.nativeTauriRuntime -ne $true) {
        throw "native probe failed: $($result | ConvertTo-Json -Depth 8 -Compress)"
    }
    return $result
}

function Start-Candidate {
    return Start-Process -FilePath $resolvedExe -WorkingDirectory (Split-Path -Parent $resolvedExe) -PassThru
}

function Stop-SpawnedCandidateOnFailure {
    param([System.Diagnostics.Process]$Process)

    if ($null -eq $Process) {
        return @()
    }
    $stopped = @()
    try {
        $Process.Refresh()
        if (-not $Process.HasExited) {
            $tree = @(Get-ProcessTreeIds -RootProcessId $Process.Id | Sort-Object -Descending)
            foreach ($processId in $tree) {
                $candidate = Get-Process -Id $processId -ErrorAction SilentlyContinue
                if ($null -eq $candidate) {
                    continue
                }
                Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
                $stopped += $processId
            }
        }
    }
    catch {
        return @($stopped)
    }
    return @($stopped)
}

function Invoke-CleanCandidateExit {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][int]$DebugPort,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $marker = "$Name-$runId"
    $cleanupNeedle = "hook_process_exit_cleanup :: reason=tauri_"
    $cleanupCountBefore = Get-RuntimeLogMatchCount -Needle $cleanupNeedle
    $exitProbe = Invoke-NativeProbe -DebugPort $DebugPort -Name "$Name-exit-probe" -Marker $marker -RequestExit
    if (-not $Process.WaitForExit($StartupTimeoutSeconds * 1000)) {
        throw "Hook did not exit after request_native_acceptance_exit"
    }
    if ($Process.ExitCode -ne 0) {
        throw "Hook native acceptance exit code was $($Process.ExitCode), expected 0"
    }
    if (-not (Wait-ForRuntimeLogText -Needle "native_acceptance_exit_requested :: marker=$marker" -TimeoutSeconds 5)) {
        throw "runtime log did not record native_acceptance_exit_requested"
    }
    $cleanupCountAfter = Wait-ForRuntimeLogMatchCount -Needle $cleanupNeedle -MinimumCount ($cleanupCountBefore + 1) -TimeoutSeconds 5
    if ($cleanupCountAfter -le $cleanupCountBefore) {
        throw "runtime log did not record the normal Tauri exit cleanup"
    }
    if (-not (Wait-ForNoPortListener -Port $DebugPort -TimeoutSeconds 15)) {
        throw "WebView2 CDP listener remained after Hook exited"
    }

    $deadline = (Get-Date).AddSeconds(15)
    do {
        $hookProcesses = @(Get-HookProcessRecords)
        if ($hookProcesses.Count -eq 0) {
            break
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    if ($hookProcesses.Count -ne 0) {
        throw "Hook or its emergency watchdog remained after clean exit"
    }

    return [pscustomobject][ordered]@{
        probe = $exitProbe
        exitCode = $Process.ExitCode
        cleanupLogCountBefore = $cleanupCountBefore
        cleanupLogCountAfter = $cleanupCountAfter
        hookProcessesAfterExit = @($hookProcesses)
        debugListenersAfterExit = @(Get-PortListenerProcessIds -Port $DebugPort)
    }
}

function Get-TreeSample {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][double]$ElapsedSeconds
    )

    $Process.Refresh()
    if ($Process.HasExited) {
        throw "Hook exited during native candidate soak with code $($Process.ExitCode)"
    }
    $treeIds = @(Get-ProcessTreeIds -RootProcessId $Process.Id)
    $privateBytes = [int64]0
    $workingSetBytes = [int64]0
    $cpuSeconds = 0.0
    $liveIds = @()
    foreach ($processId in $treeIds) {
        $treeProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $treeProcess) {
            continue
        }
        try {
            $privateBytes += [int64]$treeProcess.PrivateMemorySize64
            $workingSetBytes += [int64]$treeProcess.WorkingSet64
            $cpuSeconds += $treeProcess.TotalProcessorTime.TotalSeconds
            $liveIds += $processId
        }
        catch {
            continue
        }
    }
    return [pscustomobject][ordered]@{
        elapsedSeconds = [Math]::Round($ElapsedSeconds, 3)
        processIds = @($liveIds | Sort-Object -Unique)
        privateBytes = $privateBytes
        workingSetBytes = $workingSetBytes
        cpuSeconds = [Math]::Round($cpuSeconds, 4)
    }
}
