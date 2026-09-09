[CmdletBinding()]
param(
    [string]$OutputRoot = "",
    [ValidateRange(15, 180)]
    [int]$DurationSeconds = 30,
    [ValidateRange(250, 5000)]
    [int]$ResourceSampleIntervalMs = 1000,
    [ValidateRange(0, 15)]
    [int]$ScreenIndex = 0,
    [ValidateSet("Win32", "WinForms")]
    [string]$FixtureKind = "WinForms"
)

$ErrorActionPreference = "Stop"
$phaseFive = $env:HOOK_LIVE_PHASE5 -eq "1"
$phaseSix = $env:HOOK_LIVE_PHASE6 -eq "1"
if ($phaseFive -and $FixtureKind -ne "WinForms") {
    throw "Phase 5 input acceptance requires the WinForms fixture"
}

function Write-Utf8NoBomJson {
    param([string]$Path, [object]$Value, [int]$Depth = 10)
    $json = $Value | ConvertTo-Json -Depth $Depth
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Wait-ForPath {
    param([string]$Path, [int]$TimeoutSeconds, [string]$Label)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not (Test-Path -LiteralPath $Path)) {
        if ([DateTime]::UtcNow -ge $deadline) { throw "Timed out waiting for $Label" }
        Start-Sleep -Milliseconds 100
    }
}

function Wait-ForJsonObject {
    param([string]$Path, [int]$TimeoutSeconds, [string]$Label)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path -LiteralPath $Path) {
            try {
                $value = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | `
                    ConvertFrom-Json -ErrorAction Stop
                if ($null -ne $value) { return $value }
            } catch {
            }
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Timed out waiting for valid $Label JSON"
}

function Get-ProcessTreeIds {
    param([int[]]$RootIds)
    $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $ids = @($RootIds | Where-Object { $_ -gt 0 } | Select-Object -Unique)
    do {
        $prior = $ids.Count
        $children = @($rows | Where-Object {
            $ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId
        } | ForEach-Object { [int]$_.ProcessId })
        $ids = @($ids + $children | Select-Object -Unique)
    } while ($ids.Count -gt $prior)
    return $ids
}

function Stop-OwnedProcessTree {
    param([System.Diagnostics.Process[]]$Roots)
    $rootIds = @($Roots | Where-Object { $_ -and -not $_.HasExited } | ForEach-Object { $_.Id })
    if ($rootIds.Count -eq 0) { return }
    $ids = @(Get-ProcessTreeIds -RootIds $rootIds)
    if ($ids.Count -gt 0) { Stop-Process -Id $ids -Force -ErrorAction SilentlyContinue }
}

function Get-Median {
    param([object[]]$Rows, [string]$Property)
    $values = @($Rows | ForEach-Object { [double]$_.$Property } | Sort-Object)
    if ($values.Count -eq 0) { return 0.0 }
    $middle = [int][Math]::Floor($values.Count / 2)
    if (($values.Count % 2) -eq 1) { return $values[$middle] }
    return ($values[$middle - 1] + $values[$middle]) / 2.0
}

function Get-MaxGpuEngineUtilization {
    param([int[]]$ProcessIds)
    try {
        $values = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine `
            -ErrorAction Stop | Where-Object {
                if ($_.Name -match "pid_(\d+)_") { $ProcessIds -contains [int]$Matches[1] } else { $false }
            } | ForEach-Object { [double]$_.UtilizationPercentage })
        if ($values.Count -eq 0) { return $null }
        return [double](($values | Measure-Object -Maximum).Maximum)
    } catch {
        return $null
    }
}

function Get-SafeExitCode {
    param([System.Diagnostics.Process]$Process, [string]$ReportPath)
    $Process.Refresh()
    if (-not $Process.HasExited) { return $null }
    $Process.WaitForExit()
    if ($null -ne $Process.ExitCode) { return [int]$Process.ExitCode }
    if (Test-Path -LiteralPath $ReportPath) { return 0 }
    return -1
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$neuroRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".."))
$loomRoot = Join-Path $neuroRoot "Loom"
$artifactsRoot = Join-Path $repoRoot "artifacts"
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $artifactsRoot ("live-screenshot-phase4\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = [System.IO.Path]::GetFullPath($artifactsRoot).TrimEnd('\') + '\'
if (-not $resolvedOutput.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must stay below $artifactsRoot"
}
if (Test-Path -LiteralPath $resolvedOutput) { throw "OutputRoot already exists: $resolvedOutput" }
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

# Locked before any runtime starts. These sit below the Phase 2 observed ~4.9 fps,
# retain the Phase 2 resource-growth ceilings, and add relay/reconnect latency budgets.
$thresholds = [ordered]@{
    schemaVersion = 1
    minimumViewerFps = 3.0
    maximumP95LatencyMs = 2000
    maximumReconnectMs = 5000
    maximumAverageCpuPercent = 80.0
    maximumGpuEnginePercent = 100.0
    maximumMedianHandleGrowth = 32
    maximumMedianPrivateByteGrowth = 134217728
    minimumDistinctFrames = 2
}
Write-Utf8NoBomJson -Path (Join-Path $resolvedOutput "thresholds.json") -Value $thresholds

$windowsRoot = if ([string]::IsNullOrWhiteSpace($env:WINDIR)) {
    Split-Path -Parent ([Environment]::SystemDirectory)
} else { $env:WINDIR }
$csc = @(
    "$windowsRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$windowsRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw "The .NET Framework C# compiler is unavailable" }

$fixtureDir = Join-Path $resolvedOutput "fixture"
$fixtureExe = Join-Path $fixtureDir "HookLiveScreenshotPhaseFourFixture.exe"
$fixtureReady = Join-Path $resolvedOutput "fixture-ready.json"
$fixtureState = Join-Path $resolvedOutput "fixture-state.json"
$daemonReady = Join-Path $resolvedOutput "daemon-ready.json"
$sessionReady = Join-Path $resolvedOutput "session-ready.json"
$coordination = Join-Path $resolvedOutput "coordination"
$stopPath = Join-Path $resolvedOutput "stop"
$sourceReport = Join-Path $resolvedOutput "source.json"
$viewerAReport = Join-Path $resolvedOutput "viewer-a.json"
$viewerBReport = Join-Path $resolvedOutput "viewer-b.json"
New-Item -ItemType Directory -Path $fixtureDir, $coordination -Force | Out-Null
$fixtureSource = if ($FixtureKind -eq "Win32") {
    Join-Path $PSScriptRoot "fixtures\LiveScreenshotPhaseZeroWin32Fixture.cs"
} else {
    Join-Path $PSScriptRoot "fixtures\LiveScreenshotPhaseZeroFixture.cs"
}
$references = @("/reference:System.dll", "/reference:System.Windows.Forms.dll")
if ($FixtureKind -eq "WinForms") { $references += "/reference:System.Drawing.dll" }
& $csc /nologo /target:winexe /optimize+ "/out:$fixtureExe" $references $fixtureSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $fixtureExe)) {
    throw "Failed to compile the Phase 4 fixture"
}

$environmentNames = @(
    "LOOM_LIVE_PHASE4_READY", "LOOM_LIVE_PHASE4_STOP",
    "HOOK_LIVE_PHASE4_DAEMON_READY", "HOOK_LIVE_PHASE4_SESSION_READY",
    "HOOK_LIVE_PHASE4_COORDINATION", "HOOK_LIVE_PHASE4_STOP",
    "HOOK_LIVE_PHASE4_OUTPUT", "HOOK_LIVE_PHASE4_VIEWER",
    "HOOK_LIVE_PHASE4_DURATION_SECONDS", "HOOK_LIVE_PHASE4_HWND",
    "HOOK_LIVE_PHASE5_FIXTURE_READY", "HOOK_LIVE_PHASE5_FIXTURE_STATE",
    "HOOK_LIVE_PHASE6_FIXTURE_KIND"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

$fixture = $null
$loom = $null
$source = $null
$viewerA = $null
$viewerB = $null
try {
    $fixtureArguments = @($fixtureReady, $ScreenIndex)
    if ($phaseFive) { $fixtureArguments += $fixtureState }
    $fixture = Start-Process -FilePath $fixtureExe -ArgumentList $fixtureArguments `
        -WindowStyle Normal -PassThru
    $fixtureMetadata = Wait-ForJsonObject -Path $fixtureReady -TimeoutSeconds 20 `
        -Label "Phase 4 fixture"
    if ($fixtureMetadata.schemaVersion -ne 1 -or -not $fixtureMetadata.hwnd) {
        throw "Phase 4 fixture metadata is malformed"
    }

    [Environment]::SetEnvironmentVariable("LOOM_LIVE_PHASE4_READY", $daemonReady, "Process")
    [Environment]::SetEnvironmentVariable("LOOM_LIVE_PHASE4_STOP", $stopPath, "Process")
    $loom = Start-Process -FilePath "cargo.exe" -WorkingDirectory $loomRoot -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $resolvedOutput "loom.stdout.log") `
        -RedirectStandardError (Join-Path $resolvedOutput "loom.stderr.log") `
        -ArgumentList @(
            "test", "-p", "loom-daemon", "--locked", "--lib",
            "tests::phase_four_live_relay_acceptance_daemon", "--", "--ignored", "--exact",
            "--nocapture", "--test-threads=1"
        )
    Wait-ForPath -Path $daemonReady -TimeoutSeconds 180 -Label "Phase 4 Loom daemon"

    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_DAEMON_READY", $daemonReady, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_SESSION_READY", $sessionReady, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_COORDINATION", $coordination, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_STOP", $stopPath, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_DURATION_SECONDS", [string]$DurationSeconds, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_HWND", [string]$fixtureMetadata.hwnd, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE5_FIXTURE_READY", $fixtureReady, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE5_FIXTURE_STATE", $fixtureState, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE6_FIXTURE_KIND", $FixtureKind, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_OUTPUT", $sourceReport, "Process")
    $source = Start-Process -FilePath "cargo.exe" -WorkingDirectory $repoRoot -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $resolvedOutput "source.stdout.log") `
        -RedirectStandardError (Join-Path $resolvedOutput "source.stderr.log") `
        -ArgumentList @(
            "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--lib",
            "live_relay_acceptance_tests::phase_four_live_relay_source_endpoint", "--", "--ignored",
            "--exact", "--nocapture", "--test-threads=1"
        )
    Wait-ForPath -Path $sessionReady -TimeoutSeconds 180 -Label "Phase 4 source session"

    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_VIEWER", "A", "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_OUTPUT", $viewerAReport, "Process")
    $viewerA = Start-Process -FilePath "cargo.exe" -WorkingDirectory $repoRoot -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $resolvedOutput "viewer-a.stdout.log") `
        -RedirectStandardError (Join-Path $resolvedOutput "viewer-a.stderr.log") `
        -ArgumentList @(
            "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--lib",
            "live_relay_acceptance_tests::phase_four_live_relay_viewer_endpoint", "--", "--ignored",
            "--exact", "--nocapture", "--test-threads=1"
        )
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_VIEWER", "B", "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE4_OUTPUT", $viewerBReport, "Process")
    $viewerB = Start-Process -FilePath "cargo.exe" -WorkingDirectory $repoRoot -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $resolvedOutput "viewer-b.stdout.log") `
        -RedirectStandardError (Join-Path $resolvedOutput "viewer-b.stderr.log") `
        -ArgumentList @(
            "test", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--lib",
            "live_relay_acceptance_tests::phase_four_live_relay_viewer_endpoint", "--", "--ignored",
            "--exact", "--nocapture", "--test-threads=1"
        )

    $samples = @()
    $runStarted = [DateTime]::UtcNow
    $sampleStarted = $runStarted
    $deadline = $runStarted.AddSeconds($DurationSeconds + 180)
    $daemon = Get-Content -LiteralPath $daemonReady -Raw -Encoding UTF8 | ConvertFrom-Json
    $headers = @{ Authorization = "Bearer phase-four-live-admin" }
    $liveStatus = $null
    $liveSessions = $null
    $surfaceStream = $null
    while (-not ($viewerA.HasExited -and $viewerB.HasExited)) {
        if ([DateTime]::UtcNow -ge $deadline) { throw "Phase 4 viewers exceeded bounded runtime" }
        $relayReady = Test-Path -LiteralPath (Join-Path $coordination "viewer-b-transferred")
        if ($null -eq $liveStatus -and $relayReady) {
            try {
                $nextLiveStatus = Invoke-RestMethod -Method Get -Headers $headers `
                    -Uri ($daemon.baseUrl + "/v1/live/status")
                $nextLiveSessions = Invoke-RestMethod -Method Get -Headers $headers `
                    -Uri ($daemon.baseUrl + "/v1/live/sessions")
                $nextSurfaceStream = Invoke-WebRequest -UseBasicParsing -Method Get -Headers $headers `
                    -Uri ($daemon.baseUrl + "/v1/surfaces/stream?after=0&timeoutMs=1")
                $liveStatus = $nextLiveStatus
                $liveSessions = $nextLiveSessions
                $surfaceStream = $nextSurfaceStream
            } catch {
                if ($_.Exception.Message -notmatch "503|daemon_busy|queue is full") { throw }
            }
        }
        $ids = @(Get-ProcessTreeIds -RootIds @($loom.Id, $source.Id, $viewerA.Id, $viewerB.Id))
        $processes = @(Get-Process -Id $ids -ErrorAction SilentlyContinue)
        $gpu = Get-MaxGpuEngineUtilization -ProcessIds $ids
        $processSignature = @($processes.Id | Sort-Object) -join ","
        $samples += [ordered]@{
            elapsedMs = [long]([DateTime]::UtcNow - $sampleStarted).TotalMilliseconds
            processCount = $processes.Count
            processSignature = $processSignature
            privateBytes = [long](($processes | Measure-Object PrivateMemorySize64 -Sum).Sum)
            workingSetBytes = [long](($processes | Measure-Object WorkingSet64 -Sum).Sum)
            handles = [long](($processes | Measure-Object HandleCount -Sum).Sum)
            gpuEnginePercent = $gpu
            processes = @($processes | Sort-Object Id | ForEach-Object {
                [ordered]@{
                    processId = $_.Id
                    name = $_.ProcessName
                    cpuSeconds = [double]$_.TotalProcessorTime.TotalSeconds
                    privateBytes = [long]$_.PrivateMemorySize64
                    workingSetBytes = [long]$_.WorkingSet64
                    handles = [long]$_.HandleCount
                }
            })
        }
        Start-Sleep -Milliseconds $ResourceSampleIntervalMs
        foreach ($process in @($loom, $source, $viewerA, $viewerB)) { $process.Refresh() }
    }

    Wait-ForPath -Path (Join-Path $coordination "viewer-b-transferred") `
        -TimeoutSeconds 20 -Label "controller transfer"
    if ($null -eq $liveStatus) {
        throw "Phase 4 relay status was not sampled while both viewers were connected"
    }
    New-Item -ItemType File -Path $stopPath -Force | Out-Null
    Wait-ForPath -Path $viewerAReport -TimeoutSeconds 20 -Label "viewer A report"
    Wait-ForPath -Path $viewerBReport -TimeoutSeconds 20 -Label "viewer B report"
    Wait-ForPath -Path $sourceReport -TimeoutSeconds 30 -Label "source report"
    foreach ($process in @($viewerA, $viewerB, $source, $loom)) {
        if (-not $process.WaitForExit(30000)) { throw "Phase 4 process $($process.Id) did not exit" }
    }
    foreach ($entry in @(
        @($loom, "loom", $daemonReady), @($source, "source", $sourceReport),
        @($viewerA, "viewer A", $viewerAReport), @($viewerB, "viewer B", $viewerBReport)
    )) {
        $exitCode = Get-SafeExitCode -Process $entry[0] -ReportPath $entry[2]
        if ($exitCode -ne 0) { throw "Phase 4 $($entry[1]) process failed with exit $exitCode" }
    }

    $sourceData = Get-Content -LiteralPath $sourceReport -Raw -Encoding UTF8 | ConvertFrom-Json
    $viewerAData = Get-Content -LiteralPath $viewerAReport -Raw -Encoding UTF8 | ConvertFrom-Json
    $viewerBData = Get-Content -LiteralPath $viewerBReport -Raw -Encoding UTF8 | ConvertFrom-Json
    $sampleCount = $samples.Count
    Write-Utf8NoBomJson -Path (Join-Path $resolvedOutput "process-samples.json") -Value $samples
    $steadyGroup = @($samples | Group-Object -Property { $_.processSignature } | Sort-Object -Property `
        @{ Expression = { $_.Count }; Descending = $true }, `
        @{ Expression = { [int]$_.Group[0].processCount }; Descending = $true } | `
        Select-Object -First 1)
    $steadySamples = @($steadyGroup[0].Group)
    if ($steadySamples.Count -lt 3) {
        throw "Phase 4 captured fewer than three steady-state resource samples"
    }
    $windowSize = [Math]::Max(3, [int][Math]::Floor($steadySamples.Count * 0.2))
    $baseline = @($steadySamples | Select-Object -First $windowSize)
    $final = @($steadySamples | Select-Object -Last $windowSize)
    $elapsedSeconds = [Math]::Max(
        0.001,
        ($steadySamples[-1].elapsedMs - $steadySamples[0].elapsedMs) / 1000.0)
    $logicalProcessors = [Math]::Max(1, [Environment]::ProcessorCount)
    $firstCpuByPid = @{}
    foreach ($process in $steadySamples[0].processes) {
        $firstCpuByPid[[int]$process.processId] = [double]$process.cpuSeconds
    }
    $cpuSeconds = [double](($steadySamples[-1].processes | ForEach-Object {
        $processId = [int]$_.processId
        [Math]::Max(0.0, [double]$_.cpuSeconds - [double]$firstCpuByPid[$processId])
    } | Measure-Object -Sum).Sum)
    $averageCpuPercent = 100.0 * $cpuSeconds / ($elapsedSeconds * $logicalProcessors)
    $gpuValues = @($steadySamples | Where-Object { $null -ne $_.gpuEnginePercent } | ForEach-Object {
        [double]$_.gpuEnginePercent
    })
    $resourceSummary = [ordered]@{
        schemaVersion = 1
        samples = $sampleCount
        steadySamples = $steadySamples.Count
        steadyProcessCount = $steadySamples[-1].processCount
        averageCpuPercent = $averageCpuPercent
        gpuSamples = $gpuValues.Count
        maximumGpuEnginePercent = if ($gpuValues.Count -gt 0) {
            [double](($gpuValues | Measure-Object -Maximum).Maximum)
        } else { $null }
        medianHandleGrowth = (Get-Median $final "handles") - (Get-Median $baseline "handles")
        medianPrivateByteGrowth = (Get-Median $final "privateBytes") - (Get-Median $baseline "privateBytes")
    }
    Write-Utf8NoBomJson -Path (Join-Path $resolvedOutput "resource-summary.json") -Value $resourceSummary

    $viewerAFps = [double]$viewerAData.frames / [Math]::Max(0.001, [double]$viewerAData.durationMs / 1000.0)
    $viewerBActiveDurationMs = [Math]::Max(
        1.0,
        [double]$viewerBData.durationMs - [double]$viewerBData.reconnectDurationMs)
    $viewerBFps = [double]$viewerBData.frames / ($viewerBActiveDurationMs / 1000.0)
    $checks = [ordered]@{
        sourceContinuous = $sourceData.errors.Count -eq 0 -and $sourceData.frames -ge 3
        viewerAContinuous = $viewerAData.errors.Count -eq 0 -and `
            $viewerAFps -ge $thresholds.minimumViewerFps -and `
            $viewerAData.distinctFrames -ge $thresholds.minimumDistinctFrames
        viewerBContinuous = $viewerBData.errors.Count -eq 0 -and `
            $viewerBFps -ge $thresholds.minimumViewerFps -and `
            $viewerBData.distinctFrames -ge $thresholds.minimumDistinctFrames
        latency = $viewerAData.p95LatencyMs -le $thresholds.maximumP95LatencyMs -and `
            $viewerBData.p95LatencyMs -le $thresholds.maximumP95LatencyMs
        reconnect = $viewerBData.reconnectCount -ge 1 -and `
            $viewerBData.reconnectDurationMs -le $thresholds.maximumReconnectMs -and `
            $viewerBData.strictlyIncreasing
        controller = $viewerAData.controllerConflictObserved -and `
            $viewerAData.controllerTransferObserved -and `
            $viewerBData.controllerConflictObserved -and $viewerBData.controllerTransferObserved
        singleSession = @($liveSessions.sessions).Count -eq 1
        mediaSeparated = -not $surfaceStream.Content.Contains("NLLV")
        relayStatus = $liveStatus.activeSessions -eq 1 -and $liveStatus.connectedSources -eq 1 -and `
            $liveStatus.connectedViewers -ge 2
        cpu = $averageCpuPercent -le $thresholds.maximumAverageCpuPercent
        gpu = $gpuValues.Count -gt 0 -and `
            $resourceSummary.maximumGpuEnginePercent -le $thresholds.maximumGpuEnginePercent
        memory = $resourceSummary.medianPrivateByteGrowth -le $thresholds.maximumMedianPrivateByteGrowth
        handles = $resourceSummary.medianHandleGrowth -le $thresholds.maximumMedianHandleGrowth
    }
    $passed = -not (@($checks.Values | Where-Object { -not $_ }).Count -gt 0)
    $summary = [ordered]@{
        schemaVersion = 1
        gate = "G4"
        fixtureKind = $FixtureKind
        phaseSix = $phaseSix
        passed = $passed
        thresholds = $thresholds
        checks = $checks
        viewerAFps = $viewerAFps
        viewerBFps = $viewerBFps
        viewerBActiveDurationMs = $viewerBActiveDurationMs
        liveStatus = $liveStatus
        activeSessionCount = @($liveSessions.sessions).Count
        source = $sourceData
        viewerA = $viewerAData
        viewerB = $viewerBData
        resources = $resourceSummary
    }
    Write-Utf8NoBomJson -Path (Join-Path $resolvedOutput "summary.json") -Value $summary -Depth 12
    if (-not $passed) {
        $failed = @($checks.Keys | Where-Object { -not $checks[$_] }) -join ", "
        throw "Phase 4 G4 failed: $failed"
    }
    Write-Output $resolvedOutput
}
finally {
    if (-not (Test-Path -LiteralPath $stopPath)) {
        New-Item -ItemType File -Path $stopPath -Force -ErrorAction SilentlyContinue | Out-Null
    }
    Stop-OwnedProcessTree -Roots @($viewerA, $viewerB, $source, $loom)
    if ($fixture -and -not $fixture.HasExited) {
        if (-not $fixture.CloseMainWindow()) { Stop-Process -Id $fixture.Id -Force }
        if (-not $fixture.WaitForExit(5000)) { Stop-Process -Id $fixture.Id -Force }
    }
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
}
