[CmdletBinding()]
param(
    [string]$OutputRoot = "",
    [ValidateRange(2, 120)]
    [int]$Samples = 24,
    [ValidateRange(16, 2000)]
    [int]$IntervalMs = 100,
    [ValidateRange(0, 15)]
    [int]$ScreenIndex = 0,
    [ValidateSet("Win32", "WinForms", "Wpf")]
    [string]$FixtureKind = "WinForms"
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

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$artifactsRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts"))
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $runId = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputRoot = Join-Path $artifactsRoot "live-screenshot-phase0\$runId"
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = $artifactsRoot.TrimEnd('\') + '\'
if (-not $resolvedOutput.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must stay below $artifactsRoot"
}
if (Test-Path -LiteralPath $resolvedOutput) {
    throw "OutputRoot already exists: $resolvedOutput"
}

$fixtureSources = @{
    Win32 = "fixtures\LiveScreenshotPhaseZeroWin32Fixture.cs"
    WinForms = "fixtures\LiveScreenshotPhaseZeroFixture.cs"
    Wpf = "fixtures\LiveScreenshotPhaseZeroWpfFixture.cs"
}
$fixtureSource = Join-Path $PSScriptRoot $fixtureSources[$FixtureKind]
$fixtureDir = Join-Path $resolvedOutput "fixture"
$fixtureExe = Join-Path $fixtureDir "HookLiveScreenshotPhaseZeroFixture.exe"
$readyPath = Join-Path $resolvedOutput "fixture-ready.json"
$probePath = Join-Path $resolvedOutput "probe.json"
$stdoutPath = Join-Path $resolvedOutput "cargo-test.stdout.log"
$stderrPath = Join-Path $resolvedOutput "cargo-test.stderr.log"
New-Item -ItemType Directory -Path $fixtureDir -Force | Out-Null

$windowsRoot = if ([string]::IsNullOrWhiteSpace($env:WINDIR)) {
    Split-Path -Parent ([Environment]::SystemDirectory)
} else {
    $env:WINDIR
}
$cscCandidates = @(
    "$windowsRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$windowsRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) {
    throw "The .NET Framework C# compiler is unavailable"
}

$references = @("/reference:System.dll", "/reference:System.Windows.Forms.dll")
if ($FixtureKind -eq "WinForms") {
    $references += "/reference:System.Drawing.dll"
} elseif ($FixtureKind -eq "Wpf") {
    $gac = Join-Path $windowsRoot "Microsoft.NET\assembly"
    $wpfAssemblies = @(
        (Join-Path $gac "GAC_64\PresentationCore\v4.0_4.0.0.0__31bf3856ad364e35\PresentationCore.dll"),
        (Join-Path $gac "GAC_MSIL\PresentationFramework\v4.0_4.0.0.0__31bf3856ad364e35\PresentationFramework.dll"),
        (Join-Path $gac "GAC_MSIL\WindowsBase\v4.0_4.0.0.0__31bf3856ad364e35\WindowsBase.dll"),
        (Join-Path $gac "GAC_MSIL\System.Xaml\v4.0_4.0.0.0__b77a5c561934e089\System.Xaml.dll")
    )
    if ($wpfAssemblies | Where-Object { -not (Test-Path -LiteralPath $_) }) {
        throw "The .NET Framework WPF reference assemblies are unavailable"
    }
    $references += @($wpfAssemblies | ForEach-Object { "/reference:$_" })
}
& $csc /nologo /target:winexe /optimize+ "/out:$fixtureExe" $references $fixtureSource
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $fixtureExe)) {
    throw "Failed to compile the Phase 0 fixture"
}

$cargo = $null
$fixture = $null
$previous = @{}
foreach ($name in @(
    "HOOK_LIVE_PROBE_BOUNDS",
    "HOOK_LIVE_PROBE_HWND",
    "HOOK_LIVE_PROBE_OUTPUT",
    "HOOK_LIVE_PROBE_SAMPLES",
    "HOOK_LIVE_PROBE_INTERVAL_MS",
    "HOOK_LIVE_PROBE_FIXTURE_KIND"
)) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
    # The visible test window is the capture/input target; hiding it would invalidate the probe.
    $fixture = Start-Process -FilePath $fixtureExe -ArgumentList @($readyPath, $ScreenIndex) `
        -WindowStyle Normal -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $readyPath)) {
        if ($fixture.HasExited) {
            throw "Phase 0 fixture exited before publishing its window metadata"
        }
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "Timed out waiting for the Phase 0 fixture"
        }
        Start-Sleep -Milliseconds 100
        $fixture.Refresh()
    }

    $ready = Get-Content -LiteralPath $readyPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($ready.schemaVersion -ne 1 -or $ready.bounds.Count -ne 4 -or -not $ready.hwnd) {
        throw "Fixture metadata is malformed"
    }
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PROBE_BOUNDS", ($ready.bounds -join ','), "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PROBE_HWND", [string]$ready.hwnd, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PROBE_OUTPUT", $probePath, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PROBE_SAMPLES", [string]$Samples, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PROBE_INTERVAL_MS", [string]$IntervalMs, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PROBE_FIXTURE_KIND", $FixtureKind, "Process")

    $testName = "screenshot::wgc_persistent::live_probe_tests::phase_zero_fixture_reports_persistent_frames_uia_and_raw_input"
    $cargo = Start-Process -FilePath "cargo.exe" -WorkingDirectory $repoRoot -PassThru `
        -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath `
        -ArgumentList @("test", "--manifest-path", "src-tauri/Cargo.toml", $testName, "--", "--ignored", "--nocapture")
    $resourceStarted = [DateTime]::UtcNow
    $resourceDeadline = $resourceStarted.AddMinutes(3)
    $resourceSamples = @()
    while (-not $cargo.HasExited) {
        if ([DateTime]::UtcNow -ge $resourceDeadline) {
            $processIds = Get-ProcessTreeIds -RootId $cargo.Id
            Stop-Process -Id $processIds -Force -ErrorAction SilentlyContinue
            throw "Phase 0 Rust probe exceeded its three-minute resource bound"
        }
        $processIds = Get-ProcessTreeIds -RootId $cargo.Id
        $processes = @(Get-Process -Id $processIds -ErrorAction SilentlyContinue)
        $resourceSamples += [ordered]@{
            elapsedMs = [int]([DateTime]::UtcNow - $resourceStarted).TotalMilliseconds
            processCount = $processes.Count
            privateBytes = [long](($processes | Measure-Object PrivateMemorySize64 -Sum).Sum)
            workingSetBytes = [long](($processes | Measure-Object WorkingSet64 -Sum).Sum)
            handles = [long](($processes | Measure-Object HandleCount -Sum).Sum)
        }
        Start-Sleep -Milliseconds 200
        $cargo.Refresh()
    }
    $cargo.WaitForExit()
    $resourceEvidence = [ordered]@{
        schemaVersion = 1
        requestedSampleIntervalMs = 200
        samples = $resourceSamples
    }
    $resourceEvidence | ConvertTo-Json -Depth 5 | Set-Content `
        -LiteralPath (Join-Path $resolvedOutput "process-samples.json") -Encoding UTF8
    $cargoExitCode = $cargo.ExitCode
    if ($null -eq $cargoExitCode -and (Test-Path -LiteralPath $probePath)) {
        $completedProbe = Get-Content -LiteralPath $probePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($completedProbe.errors.Count -eq 0) {
            # Some Windows PowerShell Process wrappers lose ExitCode after HasExited polling.
            $cargoExitCode = 0
        }
    }
    if ($cargoExitCode -ne 0) {
        $tail = Get-Content -LiteralPath $stderrPath -Tail 30 -ErrorAction SilentlyContinue
        throw "Phase 0 Rust probe failed (exit $cargoExitCode): $($tail -join [Environment]::NewLine)"
    }
    if (-not (Test-Path -LiteralPath $probePath)) {
        throw "Phase 0 Rust probe did not write probe.json"
    }

    Add-Type -AssemblyName System.Windows.Forms
    $operatingSystem = Get-CimInstance Win32_OperatingSystem
    $machine = [ordered]@{
        schemaVersion = 1
        capturedAtUtc = [DateTime]::UtcNow.ToString("o")
        os = [ordered]@{
            caption = $operatingSystem.Caption
            version = $operatingSystem.Version
            buildNumber = $operatingSystem.BuildNumber
        }
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
        videoControllers = @(Get-CimInstance Win32_VideoController | ForEach-Object {
            [ordered]@{ name = $_.Name; driverVersion = $_.DriverVersion; status = $_.Status }
        })
    }
    $machine | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $resolvedOutput "machine.json") -Encoding UTF8
    Write-Output $resolvedOutput
}
finally {
    if ($cargo -and -not $cargo.HasExited) {
        $processIds = Get-ProcessTreeIds -RootId $cargo.Id
        Stop-Process -Id $processIds -Force -ErrorAction SilentlyContinue
    }
    if ($fixture -and -not $fixture.HasExited) {
        if (-not $fixture.CloseMainWindow()) {
            Stop-Process -Id $fixture.Id -Force
        }
        if (-not $fixture.WaitForExit(5000)) {
            Stop-Process -Id $fixture.Id -Force
        }
    }
    foreach ($name in $previous.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
    }
}
