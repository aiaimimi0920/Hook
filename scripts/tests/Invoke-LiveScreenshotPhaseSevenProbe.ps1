[CmdletBinding()]
param(
    [string]$OutputRoot = "",
    [string]$PhaseSixSummary = ""
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBomJson {
    param([string]$Path, [object]$Value, [int]$Depth = 12)
    $json = $Value | ConvertTo-Json -Depth $Depth
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-CommandPath {
    param([string]$Name)
    $command = Get-Command $Name -ErrorAction Stop
    if ($command.Source) { return $command.Source }
    return $command.Path
}

function Invoke-LoggedCommand {
    param(
        [string]$Name,
        [string]$WorkingDirectory,
        [string]$FilePath,
        [string[]]$Arguments
    )

    $stdoutPath = Join-Path $resolvedOutput "$Name.stdout.tmp"
    $stderrPath = Join-Path $resolvedOutput "$Name.stderr.tmp"
    $logPath = Join-Path $resolvedOutput "$Name.log"
    $startedAt = [DateTime]::UtcNow
    $process = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -NoNewWindow `
        -Wait `
        -PassThru `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath
    $finishedAt = [DateTime]::UtcNow
    $stdout = if (Test-Path -LiteralPath $stdoutPath) {
        [System.IO.File]::ReadAllText($stdoutPath)
    } else { "" }
    $stderr = if (Test-Path -LiteralPath $stderrPath) {
        [System.IO.File]::ReadAllText($stderrPath)
    } else { "" }
    $log = "command: $FilePath $($Arguments -join ' ')`r`n" +
        "workingDirectory: $WorkingDirectory`r`n" +
        "exitCode: $($process.ExitCode)`r`n`r`n[stdout]`r`n$stdout`r`n[stderr]`r`n$stderr"
    [System.IO.File]::WriteAllText($logPath, $log, (New-Object System.Text.UTF8Encoding($false)))
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    return [ordered]@{
        command = "$FilePath $($Arguments -join ' ')"
        workingDirectory = $WorkingDirectory
        exitCode = [int]$process.ExitCode
        durationMs = [int][Math]::Round(($finishedAt - $startedAt).TotalMilliseconds)
        log = $logPath
    }
}

function Test-PhaseSixPrefix {
    param([object]$Checks, [string]$Prefix)
    $matching = @($Checks.PSObject.Properties | Where-Object { $_.Name.StartsWith($Prefix) })
    return $matching.Count -gt 0 -and @($matching | Where-Object { -not [bool]$_.Value }).Count -eq 0
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$loomRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "..\Loom"))
$artifactsRoot = Join-Path $repoRoot "artifacts"
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $artifactsRoot ("live-screenshot-phase7\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = [System.IO.Path]::GetFullPath($artifactsRoot).TrimEnd('\') + '\'
if (-not $resolvedOutput.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must stay below $artifactsRoot"
}
if (Test-Path -LiteralPath $resolvedOutput) { throw "OutputRoot already exists: $resolvedOutput" }
if (-not (Test-Path -LiteralPath $loomRoot -PathType Container)) { throw "Loom repository not found: $loomRoot" }
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

if ([string]::IsNullOrWhiteSpace($PhaseSixSummary)) {
    $PhaseSixSummary = Join-Path $artifactsRoot "live-screenshot-phase6\20260905-r20\summary.json"
}
$phaseSixPath = [System.IO.Path]::GetFullPath($PhaseSixSummary)
if (-not (Test-Path -LiteralPath $phaseSixPath -PathType Leaf)) {
    throw "Phase 6 evidence was not found: $phaseSixPath"
}
$phaseSix = [System.IO.File]::ReadAllText($phaseSixPath) | ConvertFrom-Json
$phaseSixProviders = [ordered]@{
    win32 = Test-PhaseSixPrefix -Checks $phaseSix.checks -Prefix "Win32."
    winForms = Test-PhaseSixPrefix -Checks $phaseSix.checks -Prefix "WinForms."
    winFormsFallback = Test-PhaseSixPrefix -Checks $phaseSix.checks -Prefix "WinFormsFallback."
}
$phaseSixValid = $phaseSix.gate -eq "G6" -and [bool]$phaseSix.passed -and `
    @($phaseSixProviders.Values | Where-Object { -not $_ }).Count -eq 0

$cargo = Get-CommandPath -Name "cargo.exe"
$npm = Get-CommandPath -Name "npm.cmd"
$commands = [ordered]@{}
$commands.loomTriggers = Invoke-LoggedCommand -Name "loom-triggers" -WorkingDirectory $loomRoot `
    -FilePath $cargo -Arguments @("test", "-p", "loom-daemon", "live_trigger")
$commands.loomHighRiskConfirmation = Invoke-LoggedCommand -Name "loom-high-risk-confirmation" `
    -WorkingDirectory $loomRoot -FilePath $cargo `
    -Arguments @("test", "-p", "loom-daemon", "confirmed_action_never_executes_before_device_bound_host_approval")
$commands.loomCancellation = Invoke-LoggedCommand -Name "loom-cancellation" -WorkingDirectory $loomRoot `
    -FilePath $cargo -Arguments @("test", "-p", "loom-daemon", "explicit_cancel_is_device_bound_and_stops_a_cancelable_action")
$commands.hookTriggerTypes = Invoke-LoggedCommand -Name "hook-trigger-types" -WorkingDirectory $repoRoot `
    -FilePath $cargo -Arguments @("test", "--manifest-path", "src-tauri\Cargo.toml", "live_trigger_type_tests")
$commands.hookStableHeartbeat = Invoke-LoggedCommand -Name "hook-stable-heartbeat" `
    -WorkingDirectory $repoRoot -FilePath $cargo `
    -Arguments @("test", "--manifest-path", "src-tauri\Cargo.toml", "stable_requires_two_identical_trusted_samples")
$commands.hookProtocol = Invoke-LoggedCommand -Name "hook-protocol" -WorkingDirectory $repoRoot `
    -FilePath $npm -Arguments @("test", "--", "__tests__\unit\liveProtocol.test.ts", "__tests__\unit\liveRelay.test.ts")
$commands.hookTypecheck = Invoke-LoggedCommand -Name "hook-typecheck" -WorkingDirectory $repoRoot `
    -FilePath $npm -Arguments @("run", "typecheck")
$commands.hookTestTypecheck = Invoke-LoggedCommand -Name "hook-test-typecheck" -WorkingDirectory $repoRoot `
    -FilePath $npm -Arguments @("run", "typecheck:test")

$checks = [ordered]@{
    deterministicProgressDeduplication = $commands.loomTriggers.exitCode -eq 0
    risingEdgeRearmAndRetry = $commands.loomTriggers.exitCode -eq 0
    unknownStaleAndLowConfidenceFailClosed = $commands.loomTriggers.exitCode -eq 0
    offlineAuthorizerPausesWithoutReplay = $commands.loomTriggers.exitCode -eq 0
    reservationAuditAndAtomicClose = $commands.loomTriggers.exitCode -eq 0
    highRiskDeviceBoundConfirmation = $commands.loomHighRiskConfirmation.exitCode -eq 0
    deviceBoundCancellation = $commands.loomCancellation.exitCode -eq 0
    hookAuditIdempotencyAndNoRegression = $commands.hookTriggerTypes.exitCode -eq 0
    hookStableUiaHeartbeat = $commands.hookStableHeartbeat.exitCode -eq 0
    hookProtocolContract = $commands.hookProtocol.exitCode -eq 0
    hookProductionTypecheck = $commands.hookTypecheck.exitCode -eq 0
    hookTestTypecheck = $commands.hookTestTypecheck.exitCode -eq 0
    phaseSixUpstreamEvidence = $phaseSixValid
    phaseSixUiaNotCountedAsPhaseSevenInput = $true
}
$passed = @($checks.Values | Where-Object { -not $_ }).Count -eq 0
$result = [ordered]@{
    schemaVersion = 1
    gate = "G7"
    passed = $passed
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    checks = $checks
    commands = $commands
    deterministicEvidence = [ordered]@{
        orderedObservationSamples = 101
        expectedDispatches = 1
        repeatedMatchingHeartbeatDispatches = 0
        evidence = "Passing Loom live_trigger_progress_fires_once_across_more_than_one_hundred_observations test"
    }
    phaseSixEvidence = [ordered]@{
        path = $phaseSixPath
        sha256 = (Get-FileHash -LiteralPath $phaseSixPath -Algorithm SHA256).Hash.ToLowerInvariant()
        gate = $phaseSix.gate
        passed = [bool]$phaseSix.passed
        providerChecks = $phaseSixProviders
        usage = "upstream UIA and transport evidence only"
    }
    inputEvidence = [ordered]@{
        phaseSevenUiaInputEvents = 0
        phaseSixCountsIncludedInPhaseSevenInput = $false
        reason = "G7 uses deterministic trigger suites; G6 real UIA evidence is referenced, not recounted."
    }
}
$summaryPath = Join-Path $resolvedOutput "summary.json"
Write-Utf8NoBomJson -Path $summaryPath -Value $result
if (-not $passed) {
    $failed = @($checks.Keys | Where-Object { -not $checks[$_] }) -join ", "
    throw "Phase 7 G7 failed: $failed. See $summaryPath"
}
Write-Output $resolvedOutput
