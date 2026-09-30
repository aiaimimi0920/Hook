[CmdletBinding()]
param(
    [string]$OutputRoot = "",
    [ValidateRange(10, 600)]
    [int]$DurationSeconds = 600,
    [ValidateRange(250, 5000)]
    [int]$ResourceSampleIntervalMs = 1000,
    [ValidateRange(0, 15)]
    [int]$ScreenIndex = 0,
    [switch]$WindowRegion
)

$ErrorActionPreference = "Stop"

function Get-ProcessTreeIds {
    param([int]$RootId)
    $rows = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $ids = @($RootId)
    do {
        $priorCount = $ids.Count
        $children = @($rows | Where-Object {
            $ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId
        } | ForEach-Object { [int]$_.ProcessId })
        $ids = @($ids + $children | Select-Object -Unique)
    } while ($ids.Count -gt $priorCount)
    return $ids
}

function Get-Median {
    param([object[]]$Rows, [string]$Property)
    $values = @($Rows | ForEach-Object { [double]$_.$Property } | Sort-Object)
    if ($values.Count -eq 0) { return 0.0 }
    $middle = [int][Math]::Floor($values.Count / 2)
    if (($values.Count % 2) -eq 1) { return $values[$middle] }
    return ($values[$middle - 1] + $values[$middle]) / 2.0
}

function Write-Utf8NoBomJson {
    param([string]$Path, [object]$Value, [int]$Depth = 8)
    $json = $Value | ConvertTo-Json -Depth $Depth
    [System.IO.File]::WriteAllText(
        $Path,
        $json,
        (New-Object System.Text.UTF8Encoding($false))
    )
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$artifactsRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts"))
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $artifactsRoot ("live-screenshot-phase2\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = $artifactsRoot.TrimEnd('\') + '\'
if (-not $resolvedOutput.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must stay below $artifactsRoot"
}
if (Test-Path -LiteralPath $resolvedOutput) {
    throw "OutputRoot already exists: $resolvedOutput"
}
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

$windowsRoot = if ([string]::IsNullOrWhiteSpace($env:WINDIR)) {
    Split-Path -Parent ([Environment]::SystemDirectory)
} else {
    $env:WINDIR
}
$csc = @(
    "$windowsRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$windowsRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw "The .NET Framework C# compiler is unavailable" }

$fixtureDir = Join-Path $resolvedOutput "fixture"
$fixtureExe = Join-Path $fixtureDir "HookLiveScreenshotPhaseTwoFixture.exe"
$readyPath = Join-Path $resolvedOutput "fixture-ready.json"
$probePath = Join-Path $resolvedOutput "probe.json"
$stdoutPath = Join-Path $resolvedOutput "cargo-test.stdout.log"
$stderrPath = Join-Path $resolvedOutput "cargo-test.stderr.log"
New-Item -ItemType Directory -Path $fixtureDir -Force | Out-Null
$fixtureSource = Join-Path $PSScriptRoot "fixtures\LiveScreenshotPhaseZeroFixture.cs"
& $csc /nologo /target:winexe /optimize+ "/out:$fixtureExe" `
    /reference:System.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    $fixtureSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $fixtureExe)) {
    throw "Failed to compile the Phase 2 fixture"
}

$cargo = $null
$fixture = $null
$environmentNames = @(
    "HOOK_LIVE_PHASE2_DURATION_SECONDS",
    "HOOK_LIVE_PHASE2_HWND",
    "HOOK_LIVE_PHASE2_OUTPUT",
    "HOOK_LIVE_PHASE2_WINDOW_REGION"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
    $fixture = Start-Process -FilePath $fixtureExe -ArgumentList @($readyPath, $ScreenIndex) `
        -WindowStyle Normal -PassThru
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $readyPath)) {
        $fixture.Refresh()
        if ($fixture.HasExited) { throw "Phase 2 fixture exited before publishing metadata" }
        if ([DateTime]::UtcNow -ge $readyDeadline) { throw "Timed out waiting for Phase 2 fixture" }
        Start-Sleep -Milliseconds 100
    }
    $ready = Get-Content -LiteralPath $readyPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($ready.schemaVersion -ne 1 -or -not $ready.hwnd) {
        throw "Phase 2 fixture metadata is malformed"
    }

    [Environment]::SetEnvironmentVariable(
        "HOOK_LIVE_PHASE2_DURATION_SECONDS", [string]$DurationSeconds, "Process"
    )
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE2_HWND", [string]$ready.hwnd, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE2_OUTPUT", $probePath, "Process")
    [Environment]::SetEnvironmentVariable(
        "HOOK_LIVE_PHASE2_WINDOW_REGION",
        $(if ($WindowRegion) { "1" } else { $null }),
        "Process"
    )

    $testName = "screenshot::live_capture_tests::phase_two_live_worker_soaks_recovers_and_cleans_up"
    $cargo = Start-Process -FilePath "cargo.exe" -WorkingDirectory $repoRoot -PassThru `
        -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath `
        -ArgumentList @(
            "test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", $testName,
            "--", "--ignored", "--nocapture", "--test-threads=1"
        )
    $resourceStarted = [DateTime]::UtcNow
    $resourceDeadline = $resourceStarted.AddSeconds($DurationSeconds + 300)
    $resourceSamples = @()
    while (-not $cargo.HasExited) {
        if ([DateTime]::UtcNow -ge $resourceDeadline) {
            $processIds = Get-ProcessTreeIds -RootId $cargo.Id
            Stop-Process -Id $processIds -Force -ErrorAction SilentlyContinue
            throw "Phase 2 probe exceeded its bounded runtime"
        }
        $processIds = Get-ProcessTreeIds -RootId $cargo.Id
        $processes = @(Get-Process -Id $processIds -ErrorAction SilentlyContinue)
        $resourceSamples += [ordered]@{
            elapsedMs = [long]([DateTime]::UtcNow - $resourceStarted).TotalMilliseconds
            processCount = $processes.Count
            privateBytes = [long](($processes | Measure-Object PrivateMemorySize64 -Sum).Sum)
            workingSetBytes = [long](($processes | Measure-Object WorkingSet64 -Sum).Sum)
            handles = [long](($processes | Measure-Object HandleCount -Sum).Sum)
        }
        Start-Sleep -Milliseconds $ResourceSampleIntervalMs
        $cargo.Refresh()
    }
    $cargo.WaitForExit()
    $cargoExitCode = $cargo.ExitCode
    if ($null -eq $cargoExitCode -and (Test-Path -LiteralPath $probePath)) {
        $completedProbe = Get-Content -LiteralPath $probePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($completedProbe.errors.Count -eq 0) { $cargoExitCode = 0 }
    }
    if ($cargoExitCode -ne 0) {
        $tail = Get-Content -LiteralPath $stderrPath -Tail 40 -ErrorAction SilentlyContinue
        throw "Phase 2 Rust probe failed (exit $cargoExitCode): $($tail -join [Environment]::NewLine)"
    }
    if (-not (Test-Path -LiteralPath $probePath)) {
        throw "Phase 2 Rust probe did not write probe.json"
    }
    $probe = Get-Content -LiteralPath $probePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($probe.errors.Count -ne 0) {
        throw "Phase 2 semantic probe reported errors: $($probe.errors -join '; ')"
    }

    $resourceEvidence = [ordered]@{
        schemaVersion = 1
        requestedSampleIntervalMs = $ResourceSampleIntervalMs
        samples = $resourceSamples
    }
    Write-Utf8NoBomJson -Path (Join-Path $resolvedOutput "process-samples.json") `
        -Value $resourceEvidence -Depth 6

    $resourceSummary = [ordered]@{
        schemaVersion = 1
        enforced = ($DurationSeconds -ge 300)
        baselineWindow = "120-180 seconds"
        comparisonWindow = "last 60 seconds"
        maximumMedianHandleGrowth = 32
        maximumMedianPrivateByteGrowth = 134217728
        baselineMedianHandles = 0
        finalMedianHandles = 0
        medianHandleGrowth = 0
        baselineMedianPrivateBytes = 0
        finalMedianPrivateBytes = 0
        medianPrivateByteGrowth = 0
        passed = $true
    }
    if ($DurationSeconds -ge 300) {
        $baseline = @($resourceSamples | Where-Object {
            $_.elapsedMs -ge 120000 -and $_.elapsedMs -le 180000
        })
        $lastElapsed = [long]($resourceSamples[-1].elapsedMs)
        $final = @($resourceSamples | Where-Object { $_.elapsedMs -ge ($lastElapsed - 60000) })
        if ($baseline.Count -lt 10 -or $final.Count -lt 10) {
            throw "Phase 2 resource windows did not contain enough samples"
        }
        $resourceSummary.baselineMedianHandles = Get-Median $baseline "handles"
        $resourceSummary.finalMedianHandles = Get-Median $final "handles"
        $resourceSummary.medianHandleGrowth = `
            $resourceSummary.finalMedianHandles - $resourceSummary.baselineMedianHandles
        $resourceSummary.baselineMedianPrivateBytes = Get-Median $baseline "privateBytes"
        $resourceSummary.finalMedianPrivateBytes = Get-Median $final "privateBytes"
        $resourceSummary.medianPrivateByteGrowth = `
            $resourceSummary.finalMedianPrivateBytes - $resourceSummary.baselineMedianPrivateBytes
        $resourceSummary.passed = `
            $resourceSummary.medianHandleGrowth -le $resourceSummary.maximumMedianHandleGrowth -and `
            $resourceSummary.medianPrivateByteGrowth -le $resourceSummary.maximumMedianPrivateByteGrowth
    }
    Write-Utf8NoBomJson -Path (Join-Path $resolvedOutput "resource-summary.json") `
        -Value $resourceSummary
    if (-not $resourceSummary.passed) {
        throw "Phase 2 resource growth exceeded the locked G2 limits"
    }

    Add-Type -AssemblyName System.Windows.Forms
    $machine = [ordered]@{
        schemaVersion = 1
        capturedAtUtc = [DateTime]::UtcNow.ToString("o")
        sessionName = $env:SESSIONNAME
        userInteractive = [Environment]::UserInteractive
        screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
            [ordered]@{
                deviceName = $_.DeviceName
                primary = $_.Primary
                bounds = @($_.Bounds.Left, $_.Bounds.Top, $_.Bounds.Right, $_.Bounds.Bottom)
                workingArea = @($_.WorkingArea.Left, $_.WorkingArea.Top, $_.WorkingArea.Right, $_.WorkingArea.Bottom)
                bitsPerPixel = $_.BitsPerPixel
            }
        })
    }
    Write-Utf8NoBomJson -Path (Join-Path $resolvedOutput "machine.json") -Value $machine
    Write-Output $resolvedOutput
}
finally {
    if ($cargo -and -not $cargo.HasExited) {
        $processIds = Get-ProcessTreeIds -RootId $cargo.Id
        Stop-Process -Id $processIds -Force -ErrorAction SilentlyContinue
    }
    if ($fixture -and -not $fixture.HasExited) {
        if (-not $fixture.CloseMainWindow()) { Stop-Process -Id $fixture.Id -Force }
        if (-not $fixture.WaitForExit(5000)) { Stop-Process -Id $fixture.Id -Force }
    }
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
}
