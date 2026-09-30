[CmdletBinding()]
param(
    [string]$OutputRoot = "",
    [ValidateRange(15, 180)]
    [int]$DurationSeconds = 15,
    [ValidateRange(250, 5000)]
    [int]$ResourceSampleIntervalMs = 1000,
    [ValidateRange(0, 15)]
    [int]$ScreenIndex = 0
)

$ErrorActionPreference = "Stop"

function Test-ProviderEvidence {
    param([object]$Summary)

    $source = $Summary.source.observation
    $viewerA = $Summary.viewerA.observation
    $viewerB = $Summary.viewerB.observation
    $requiredTypes = @("Window", "ProgressBar", "Button", "Text", "CheckBox", "Slider")
    $types = @($source.controlTypes)
    $patterns = @($source.controls | ForEach-Object { @($_.patterns) } | Select-Object -Unique)
    $advertisedPatterns = @($source.capabilities | Where-Object { $_ -ne "uia_tree" })
    $patternHonesty = @($advertisedPatterns | Where-Object { $patterns -notcontains $_ }).Count -eq 0
    $requiredControls = @($requiredTypes | Where-Object { $types -notcontains $_ }).Count -eq 0
    $viewerCapabilities = @($viewerA.capabilities) -contains "uia_tree" -and `
        @($viewerB.capabilities) -contains "uia_tree"

    return [ordered]@{
        transportBaseline = [bool]$Summary.passed
        advertisedUiaTree = @($source.capabilities) -contains "uia_tree"
        requiredControls = $requiredControls
        multiControlAnchors = [int]$source.anchored -ge 4
        exactProviderValues = [int]$source.exactValues -ge 4 -and [int]$source.errors -eq 0
        stableBindings = [int]$source.stable -ge 3
        patternHonesty = $patternHonesty
        reliableViewerFanout = $viewerCapabilities -and `
            [int]$viewerA.total -ge 4 -and [int]$viewerB.total -ge 4 -and `
            [int]$viewerA.errors -eq 0 -and [int]$viewerB.errors -eq 0
        logicalHideObservation = [bool]$source.logicalHideCorrect
        staleLocatorRecovery = [bool]$source.locatorContinuity
        eventOwnerCleanup = [bool]$source.workerStoppedCleanly
    }
}

function Write-Utf8NoBomJson {
    param([string]$Path, [object]$Value, [int]$Depth = 18)
    $json = $Value | ConvertTo-Json -Depth $Depth
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$artifactsRoot = Join-Path $repoRoot "artifacts"
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $artifactsRoot ("live-screenshot-phase6\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = [System.IO.Path]::GetFullPath($artifactsRoot).TrimEnd('\') + '\'
if (-not $resolvedOutput.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must stay below $artifactsRoot"
}
if (Test-Path -LiteralPath $resolvedOutput) { throw "OutputRoot already exists: $resolvedOutput" }
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

$previousPhaseFive = [Environment]::GetEnvironmentVariable("HOOK_LIVE_PHASE5", "Process")
$previousPhaseSix = [Environment]::GetEnvironmentVariable("HOOK_LIVE_PHASE6", "Process")
try {
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE6", "1", "Process")
    $providers = @()
    $allChecks = [ordered]@{}
    $providerDurationSeconds = [Math]::Max(30, $DurationSeconds)
    foreach ($kind in @("Win32", "WinForms")) {
        [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE5", $null, "Process")
        $providerRoot = Join-Path $resolvedOutput $kind
        & (Join-Path $PSScriptRoot "Invoke-LiveScreenshotPhaseFourProbe.ps1") `
            -OutputRoot $providerRoot `
            -DurationSeconds $providerDurationSeconds `
            -ResourceSampleIntervalMs $ResourceSampleIntervalMs `
            -ScreenIndex $ScreenIndex `
            -FixtureKind $kind | Out-Null
        $summary = Get-Content -LiteralPath (Join-Path $providerRoot "summary.json") `
            -Raw -Encoding UTF8 | ConvertFrom-Json
        $checks = Test-ProviderEvidence -Summary $summary
        foreach ($name in $checks.Keys) {
            $allChecks["$kind.$name"] = [bool]$checks[$name]
        }
        $providers += [ordered]@{
            fixtureKind = $kind
            outputRoot = $providerRoot
            checks = $checks
            sourceObservation = $summary.source.observation
            viewerAObservation = $summary.viewerA.observation
            viewerBObservation = $summary.viewerB.observation
        }
    }
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE6", $null, "Process")
    $fallbackRoot = Join-Path $resolvedOutput "WinFormsFallback"
    $fallbackDurationSeconds = [Math]::Max(45, $DurationSeconds)
    $fallbackInvocationError = $null
    try {
        & (Join-Path $PSScriptRoot "Invoke-LiveScreenshotPhaseFiveProbe.ps1") `
            -OutputRoot $fallbackRoot `
            -DurationSeconds $fallbackDurationSeconds `
            -ResourceSampleIntervalMs $ResourceSampleIntervalMs `
            -ScreenIndex $ScreenIndex | Out-Null
    } catch {
        $fallbackInvocationError = $_.Exception.Message
    }
    $fallbackSummary = Get-Content -LiteralPath (Join-Path $fallbackRoot "summary.json") `
        -Raw -Encoding UTF8 | ConvertFrom-Json
    $fallbackChecks = [ordered]@{
        realInputLoop = [bool]$fallbackSummary.source.inputDelivered -and `
            [bool]$fallbackSummary.viewerB.inputDelivered -and `
            [int]$fallbackSummary.viewerB.inputEventsSent -eq 10
        sourceReclaim = [bool]$fallbackSummary.source.sourceReclaimObserved -and `
            [bool]$fallbackSummary.viewerB.sourceReclaimObserved
        releasedInputs = [bool]$fallbackSummary.source.interactionReleased -and `
            [bool]$fallbackSummary.viewerB.interactionReleased
        noEndpointErrors = @($fallbackSummary.source.errors).Count -eq 0 -and `
            @($fallbackSummary.viewerA.errors).Count -eq 0 -and `
            @($fallbackSummary.viewerB.errors).Count -eq 0
        noSemanticDependency = [int]$fallbackSummary.source.observation.total -eq 0
    }
    foreach ($name in $fallbackChecks.Keys) {
        $allChecks["WinFormsFallback.$name"] = [bool]$fallbackChecks[$name]
    }
    $passed = -not (@($allChecks.Values | Where-Object { -not $_ }).Count -gt 0)
    $result = [ordered]@{
        schemaVersion = 1
        gate = "G6"
        passed = $passed
        supportedProviders = @("classic_win32", "winforms")
        excludedProviders = @("wpf_pending_continuity", "winui_unsupported")
        checks = $allChecks
        providers = $providers
        nonSemanticInputFallback = [ordered]@{
            fixtureKind = "WinForms"
            outputRoot = $fallbackRoot
            phaseFiveGate = $fallbackSummary.gate
            invocationError = $fallbackInvocationError
            passed = -not (@($fallbackChecks.Values | Where-Object { -not $_ }).Count -gt 0)
            checks = $fallbackChecks
        }
    }
    Write-Utf8NoBomJson -Path (Join-Path $resolvedOutput "summary.json") -Value $result
    if (-not $passed) {
        $failed = @($allChecks.Keys | Where-Object { -not $allChecks[$_] }) -join ", "
        throw "Phase 6 G6 failed: $failed"
    }
    Write-Output $resolvedOutput
}
finally {
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE5", $previousPhaseFive, "Process")
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE6", $previousPhaseSix, "Process")
}
