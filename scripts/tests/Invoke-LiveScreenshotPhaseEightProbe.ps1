[CmdletBinding()]
param(
    [string]$OutputRoot = "",
    [string]$PhaseSevenSummary = ""
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
    $stdout = if (Test-Path -LiteralPath $stdoutPath) { [System.IO.File]::ReadAllText($stdoutPath) } else { "" }
    $stderr = if (Test-Path -LiteralPath $stderrPath) { [System.IO.File]::ReadAllText($stderrPath) } else { "" }
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

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$loomRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "..\Loom"))
$artifactsRoot = Join-Path $repoRoot "artifacts"
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $artifactsRoot ("live-screenshot-phase8\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = [System.IO.Path]::GetFullPath($artifactsRoot).TrimEnd('\') + '\'
if (-not $resolvedOutput.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must stay below $artifactsRoot"
}
if (Test-Path -LiteralPath $resolvedOutput) { throw "OutputRoot already exists: $resolvedOutput" }
if (-not (Test-Path -LiteralPath $loomRoot -PathType Container)) { throw "Loom repository not found: $loomRoot" }
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

if ([string]::IsNullOrWhiteSpace($PhaseSevenSummary)) {
    $PhaseSevenSummary = Join-Path $artifactsRoot "live-screenshot-phase7\20260905-r3\summary.json"
}
$phaseSevenPath = [System.IO.Path]::GetFullPath($PhaseSevenSummary)
if (-not (Test-Path -LiteralPath $phaseSevenPath -PathType Leaf)) {
    throw "Phase 7 evidence was not found: $phaseSevenPath"
}
$phaseSeven = [System.IO.File]::ReadAllText($phaseSevenPath) | ConvertFrom-Json
$phaseSevenValid = $phaseSeven.gate -eq "G7" -and [bool]$phaseSeven.passed

$cargo = Get-CommandPath -Name "cargo.exe"
$npm = Get-CommandPath -Name "npm.cmd"
$commands = [ordered]@{}
$commands.loomObservationContract = Invoke-LoggedCommand -Name "loom-observation-contract" `
    -WorkingDirectory $loomRoot -FilePath $cargo -Arguments @("test", "-p", "loom_protocol", "observations")
$commands.loomHighRiskTrust = Invoke-LoggedCommand -Name "loom-high-risk-trust" `
    -WorkingDirectory $loomRoot -FilePath $cargo `
    -Arguments @("test", "-p", "loom-daemon", "phase_eight_visual_observations_cannot_dispatch_high_risk_actions")
$commands.hookExtensionContract = Invoke-LoggedCommand -Name "hook-extension-contract" `
    -WorkingDirectory $repoRoot -FilePath $cargo `
    -Arguments @("test", "--manifest-path", "src-tauri\Cargo.toml", "live_extension_capability_tests")
$commands.hookVisualTrust = Invoke-LoggedCommand -Name "hook-visual-trust" `
    -WorkingDirectory $repoRoot -FilePath $cargo `
    -Arguments @("test", "--manifest-path", "src-tauri\Cargo.toml", "visual_observations_cannot_claim_exact_confidence")
$commands.hookProtocol = Invoke-LoggedCommand -Name "hook-protocol" -WorkingDirectory $repoRoot `
    -FilePath $npm -Arguments @("test", "--", "__tests__\unit\liveProtocol.test.ts", "__tests__\unit\liveExtensions.test.ts")
$commands.hookTypecheck = Invoke-LoggedCommand -Name "hook-typecheck" -WorkingDirectory $repoRoot `
    -FilePath $npm -Arguments @("run", "typecheck")
$commands.hookTestTypecheck = Invoke-LoggedCommand -Name "hook-test-typecheck" -WorkingDirectory $repoRoot `
    -FilePath $npm -Arguments @("run", "typecheck:test")

$checks = [ordered]@{
    observationSourceAndConfidenceRequired = $commands.loomObservationContract.exitCode -eq 0 -and $commands.hookVisualTrust.exitCode -eq 0
    visualExactConfidenceRejected = $commands.loomObservationContract.exitCode -eq 0 -and $commands.hookProtocol.exitCode -eq 0
    visualHighRiskActionRejected = $commands.loomHighRiskTrust.exitCode -eq 0
    adapterPackageTrustBoundary = $commands.hookExtensionContract.exitCode -eq 0 -and $commands.hookProtocol.exitCode -eq 0
    unavailableExtensionsReportedHonestly = $commands.hookExtensionContract.exitCode -eq 0 -and $commands.hookProtocol.exitCode -eq 0
    hookProductionTypecheck = $commands.hookTypecheck.exitCode -eq 0
    hookTestTypecheck = $commands.hookTestTypecheck.exitCode -eq 0
    phaseSevenUpstreamEvidence = $phaseSevenValid
}
$passed = @($checks.Values | Where-Object { -not $_ }).Count -eq 0
$result = [ordered]@{
    schemaVersion = 1
    gate = "G8"
    scope = "extension capability discovery and fail-closed trust contract"
    passed = $passed
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    checks = $checks
    commands = $commands
    capabilityInventory = [ordered]@{
        adapters = @("browser_accessibility", "electron_accessibility", "special_rendering")
        visual = @("vision_observation")
        interaction = @("touch_input", "pen_input", "ime_input", "clipboard_input", "file_drop_input")
        advertisedAvailable = @()
        unavailableReasonRequired = $true
    }
    runtimeClaims = [ordered]@{
        adapterInstalled = $false
        visualProviderInstalled = $false
        extendedInputBackendImplemented = $false
        note = "G8 proves discovery and denial contracts. It does not count unavailable providers as runtime support."
    }
    phaseSevenEvidence = [ordered]@{
        path = $phaseSevenPath
        sha256 = (Get-FileHash -LiteralPath $phaseSevenPath -Algorithm SHA256).Hash.ToLowerInvariant()
        gate = $phaseSeven.gate
        passed = [bool]$phaseSeven.passed
        usage = "upstream deterministic trigger and real UIA reference only"
    }
}
$summaryPath = Join-Path $resolvedOutput "summary.json"
Write-Utf8NoBomJson -Path $summaryPath -Value $result
if (-not $passed) {
    $failed = @($checks.Keys | Where-Object { -not $checks[$_] }) -join ", "
    throw "Phase 8 G8 failed: $failed. See $summaryPath"
}
Write-Output $resolvedOutput
