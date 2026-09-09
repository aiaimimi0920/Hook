[CmdletBinding()]
param(
    [string]$OutputRoot = "",
    [ValidateSet("All", "Win32", "WinForms")]
    [string]$FixtureKind = "All",
    [ValidateRange(0, 15)]
    [int]$ScreenIndex = 0,
    [switch]$WindowRegion
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBomJson {
    param([string]$Path, [object]$Value, [int]$Depth = 8)
    [System.IO.File]::WriteAllText(
        $Path,
        ($Value | ConvertTo-Json -Depth $Depth),
        (New-Object System.Text.UTF8Encoding($false))
    )
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$artifactsRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts"))
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $artifactsRoot ("live-screenshot-phase3\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
if (-not $resolvedOutput.StartsWith($artifactsRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must stay below $artifactsRoot"
}
if (Test-Path -LiteralPath $resolvedOutput) { throw "OutputRoot already exists: $resolvedOutput" }
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

$windowsRoot = if ([string]::IsNullOrWhiteSpace($env:WINDIR)) {
    Split-Path -Parent ([Environment]::SystemDirectory)
} else { $env:WINDIR }
$csc = @(
    "$windowsRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$windowsRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw "The .NET Framework C# compiler is unavailable" }

$environmentNames = @(
    "HOOK_LIVE_PHASE3_HWND",
    "HOOK_LIVE_PHASE3_FIXTURE_KIND",
    "HOOK_LIVE_PHASE3_OUTPUT",
    "HOOK_LIVE_PHASE3_WINDOW_REGION"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

function Invoke-PhaseThreeFixture {
    param([string]$Kind)
    $sampleRoot = Join-Path $resolvedOutput $Kind.ToLowerInvariant()
    $fixtureDir = Join-Path $sampleRoot "fixture"
    $fixtureExe = Join-Path $fixtureDir ("HookLiveScreenshotPhaseThree{0}Fixture.exe" -f $Kind)
    $readyPath = Join-Path $sampleRoot "fixture-ready.json"
    $probePath = Join-Path $sampleRoot "probe.json"
    $stdoutPath = Join-Path $sampleRoot "cargo-test.stdout.log"
    $stderrPath = Join-Path $sampleRoot "cargo-test.stderr.log"
    New-Item -ItemType Directory -Path $fixtureDir -Force | Out-Null
    $fixtureSource = if ($Kind -eq "Win32") {
        Join-Path $PSScriptRoot "fixtures\LiveScreenshotPhaseZeroWin32Fixture.cs"
    } else {
        Join-Path $PSScriptRoot "fixtures\LiveScreenshotPhaseZeroFixture.cs"
    }
    & $csc /nologo /target:winexe /optimize+ "/out:$fixtureExe" `
        /reference:System.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
        $fixtureSource
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $fixtureExe)) {
        throw "Failed to compile the $Kind Phase 3 fixture"
    }

    $fixture = $null
    $cargo = $null
    try {
        $fixture = Start-Process -FilePath $fixtureExe -ArgumentList @($readyPath, $ScreenIndex) `
            -WindowStyle Normal -PassThru
        $readyDeadline = [DateTime]::UtcNow.AddSeconds(20)
        while (-not (Test-Path -LiteralPath $readyPath)) {
            $fixture.Refresh()
            if ($fixture.HasExited) { throw "$Kind fixture exited before publishing metadata" }
            if ([DateTime]::UtcNow -ge $readyDeadline) { throw "Timed out waiting for $Kind fixture" }
            Start-Sleep -Milliseconds 100
        }
        $ready = Get-Content -LiteralPath $readyPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($ready.schemaVersion -ne 1 -or -not $ready.hwnd) { throw "$Kind fixture metadata is malformed" }
        [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE3_HWND", [string]$ready.hwnd, "Process")
        [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE3_FIXTURE_KIND", $Kind, "Process")
        [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE3_OUTPUT", $probePath, "Process")
        [Environment]::SetEnvironmentVariable(
            "HOOK_LIVE_PHASE3_WINDOW_REGION",
            $(if ($WindowRegion) { "1" } else { $null }),
            "Process"
        )

        $testName = "screenshot::live_source_phase3_tests::phase_three_logical_hide_input_reclaim_and_restore"
        $cargo = Start-Process -FilePath "cargo.exe" -WorkingDirectory $repoRoot -PassThru `
            -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath `
            -ArgumentList @(
                "test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", $testName,
                "--", "--ignored", "--nocapture", "--test-threads=1"
            )
        if (-not $cargo.WaitForExit(180000)) {
            Stop-Process -Id $cargo.Id -Force -ErrorAction SilentlyContinue
            throw "$Kind Phase 3 probe exceeded its bounded runtime"
        }
        $cargo.WaitForExit()
        $cargo.Refresh()
        $cargoExitCode = $cargo.ExitCode
        if ($null -eq $cargoExitCode -and (Test-Path -LiteralPath $probePath)) {
            $completedProbe = Get-Content -LiteralPath $probePath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($completedProbe.errors.Count -eq 0) { $cargoExitCode = 0 }
        }
        if ($cargoExitCode -ne 0) {
            $tail = Get-Content -LiteralPath $stderrPath -Tail 50 -ErrorAction SilentlyContinue
            throw "$Kind Phase 3 Rust probe failed (exit $cargoExitCode): $($tail -join [Environment]::NewLine)"
        }
        if (-not (Test-Path -LiteralPath $probePath)) { throw "$Kind probe did not write probe.json" }
        $probe = Get-Content -LiteralPath $probePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($probe.errors.Count -ne 0) { throw "$Kind semantic probe failed: $($probe.errors -join '; ')" }
        return $probe
    }
    finally {
        if ($cargo -and -not $cargo.HasExited) { Stop-Process -Id $cargo.Id -Force -ErrorAction SilentlyContinue }
        if ($fixture -and -not $fixture.HasExited) {
            if (-not $fixture.CloseMainWindow()) { Stop-Process -Id $fixture.Id -Force -ErrorAction SilentlyContinue }
            if (-not $fixture.WaitForExit(5000)) { Stop-Process -Id $fixture.Id -Force -ErrorAction SilentlyContinue }
        }
    }
}

try {
    $kinds = if ($FixtureKind -eq "All") { @("Win32", "WinForms") } else { @($FixtureKind) }
    $samples = @($kinds | ForEach-Object { Invoke-PhaseThreeFixture -Kind $_ })
    $declaredSupport = @("Win32", "WinForms")
    $samplePassed = @($samples | Where-Object { $_.errors.Count -ne 0 }).Count -eq 0
    $completeDeclaredMatrix = @($declaredSupport | Where-Object { $_ -notin $kinds }).Count -eq 0
    $summary = [ordered]@{
        schemaVersion = 1
        capturedAtUtc = [DateTime]::UtcNow.ToString("o")
        osVersion = [Environment]::OSVersion.VersionString
        sessionName = $env:SESSIONNAME
        screenIndex = $ScreenIndex
        declaredSupport = $declaredSupport
        sampledSupport = $kinds
        completeDeclaredMatrix = $completeDeclaredMatrix
        logicalHideStrategy = "near_transparent_compositor_window"
        nativeMinimizeClaimed = $false
        windowRegionInput = [bool]$WindowRegion
        samples = $samples
        passed = $samplePassed
        g3Passed = $samplePassed -and $completeDeclaredMatrix
    }
    Write-Utf8NoBomJson -Path (Join-Path $resolvedOutput "summary.json") -Value $summary -Depth 10
    if (-not $summary.passed) { throw "Phase 3 sample summary did not pass" }
    if ($FixtureKind -eq "All" -and -not $summary.g3Passed) { throw "Phase 3 G3 summary did not pass" }
    Write-Output $resolvedOutput
}
finally {
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
}
