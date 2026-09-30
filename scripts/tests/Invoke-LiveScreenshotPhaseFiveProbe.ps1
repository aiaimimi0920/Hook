[CmdletBinding()]
param(
    [string]$OutputRoot = "",
    [ValidateRange(15, 180)]
    [int]$DurationSeconds = 30,
    [ValidateRange(250, 5000)]
    [int]$ResourceSampleIntervalMs = 1000,
    [ValidateRange(0, 15)]
    [int]$ScreenIndex = 0
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$artifactsRoot = Join-Path $repoRoot "artifacts"
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $artifactsRoot ("live-screenshot-phase5\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = [System.IO.Path]::GetFullPath($artifactsRoot).TrimEnd('\') + '\'
if (-not $resolvedOutput.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must stay below $artifactsRoot"
}

$previous = [Environment]::GetEnvironmentVariable("HOOK_LIVE_PHASE5", "Process")
try {
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE5", "1", "Process")
    & (Join-Path $PSScriptRoot "Invoke-LiveScreenshotPhaseFourProbe.ps1") `
        -OutputRoot $resolvedOutput `
        -DurationSeconds $DurationSeconds `
        -ResourceSampleIntervalMs $ResourceSampleIntervalMs `
        -ScreenIndex $ScreenIndex | Out-Null

    $summaryPath = Join-Path $resolvedOutput "summary.json"
    $summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $g4Checks = $summary.checks
    $checks = [ordered]@{
        transportBaseline = [bool]$summary.passed
        realInputLoop = [bool]$summary.source.inputDelivered -and `
            [int]$summary.viewerB.inputEventsSent -eq 10
        multiViewerIsolation = [bool]$summary.checks.viewerAContinuous -and `
            [bool]$summary.checks.viewerBContinuous
        singleController = [bool]$summary.checks.controller
        sourceReclaim = [bool]$summary.source.sourceReclaimObserved -and `
            [bool]$summary.viewerB.sourceReclaimObserved
        releasedInputs = [bool]$summary.source.interactionReleased -and `
            [bool]$summary.viewerB.interactionReleased
        pairedDeviceSmoke = [bool]$summary.checks.singleSession -and `
            [bool]$summary.checks.mediaSeparated -and [bool]$summary.checks.relayStatus
    }
    $passed = -not (@($checks.Values | Where-Object { -not $_ }).Count -gt 0)
    $summary.gate = "G5"
    $summary.passed = $passed
    $summary | Add-Member -NotePropertyName g4Checks -NotePropertyValue $g4Checks
    $summary.checks = $checks
    $summary | Add-Member -NotePropertyName topology `
        -NotePropertyValue "single-host / three paired device sessions / real Loom HTTP+WebSocket"
    $json = $summary | ConvertTo-Json -Depth 14
    [System.IO.File]::WriteAllText(
        $summaryPath,
        $json,
        (New-Object System.Text.UTF8Encoding($false)))
    if (-not $passed) {
        $failed = @($checks.Keys | Where-Object { -not $checks[$_] }) -join ", "
        throw "Phase 5 G5 failed: $failed"
    }
    Write-Output $resolvedOutput
}
finally {
    [Environment]::SetEnvironmentVariable("HOOK_LIVE_PHASE5", $previous, "Process")
}
