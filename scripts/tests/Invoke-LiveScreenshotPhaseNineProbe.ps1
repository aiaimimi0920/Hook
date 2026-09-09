[CmdletBinding()]
param(
    [string]$OutputRoot = "",
    [string]$PhaseEightSummary = "",
    [string]$LoomReleasePath = "",
    [string]$HookReleasePath = "",
    [switch]$AllowPartial
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
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory -NoNewWindow -Wait -PassThru `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
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

function Get-ReleaseEvidence {
    param([string]$ReleasePath, [string]$ExecutableRelativePath, [string]$ExpectedApp)
    if ([string]::IsNullOrWhiteSpace($ReleasePath)) {
        return [ordered]@{ present = $false; cleanSource = $false; reason = "release_path_not_supplied" }
    }
    $resolved = [System.IO.Path]::GetFullPath($ReleasePath)
    $manifestPath = Join-Path $resolved "manifest.json"
    $executablePath = Join-Path $resolved $ExecutableRelativePath
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
        -not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
        return [ordered]@{ present = $false; cleanSource = $false; path = $resolved; reason = "release_payload_incomplete" }
    }
    $manifest = [System.IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
    $properties = @($manifest.PSObject.Properties.Name)
    $provenanceValid = $properties -contains "gitDirty" -and
        $properties -contains "sourceGitDirty" -and
        $manifest.gitDirty -is [bool] -and
        $manifest.sourceGitDirty -is [bool] -and
        [string]$manifest.app -ceq $ExpectedApp -and
        [string]$manifest.versionId -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' -and
        [string]$manifest.gitHead -match '^[0-9a-f]{40}$'
    $cleanSource = $provenanceValid -and
        $manifest.gitDirty -eq $false -and $manifest.sourceGitDirty -eq $false
    return [ordered]@{
        present = $true
        cleanSource = $cleanSource
        provenanceValid = $provenanceValid
        reason = if ($provenanceValid) { $null } else { "invalid_release_provenance" }
        path = $resolved
        versionId = $manifest.versionId
        gitHead = $manifest.gitHead
        manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
        executableSha256 = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$loomRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "..\Loom"))
$artifactsRoot = Join-Path $repoRoot "artifacts"
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $artifactsRoot ("live-screenshot-phase9\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputRoot)
$allowedPrefix = [System.IO.Path]::GetFullPath($artifactsRoot).TrimEnd('\') + '\'
if (-not $resolvedOutput.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must stay below $artifactsRoot"
}
if (Test-Path -LiteralPath $resolvedOutput) { throw "OutputRoot already exists: $resolvedOutput" }
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

if ([string]::IsNullOrWhiteSpace($PhaseEightSummary)) {
    $PhaseEightSummary = Join-Path $artifactsRoot "live-screenshot-phase8\20260905-r2\summary.json"
}
$phaseEightPath = [System.IO.Path]::GetFullPath($PhaseEightSummary)
if (-not (Test-Path -LiteralPath $phaseEightPath -PathType Leaf)) {
    throw "Phase 8 evidence was not found: $phaseEightPath"
}
$phaseEight = [System.IO.File]::ReadAllText($phaseEightPath) | ConvertFrom-Json
$phaseEightValid = $phaseEight.gate -eq "G8" -and [bool]$phaseEight.passed

$cargo = Get-CommandPath -Name "cargo.exe"
$npm = Get-CommandPath -Name "npm.cmd"
$commands = [ordered]@{}
$commands.loomNonLoopbackSecurity = Invoke-LoggedCommand -Name "loom-non-loopback-security" -WorkingDirectory $loomRoot `
    -FilePath $cargo -Arguments @("test", "-p", "loom-daemon", "daemon_requires_tls_and_bearer_auth_for_non_loopback_routes")
$commands.loomDeviceReplayRevocation = Invoke-LoggedCommand -Name "loom-device-replay-revocation" -WorkingDirectory $loomRoot `
    -FilePath $cargo -Arguments @("test", "-p", "loom-daemon", "device_pairing_issues_short_lived_session_rejects_replay_and_revokes_on_disable")
$commands.loomUrlSecurity = Invoke-LoggedCommand -Name "loom-url-security" -WorkingDirectory $loomRoot `
    -FilePath $cargo -Arguments @("test", "-p", "loom_protocol", "external_navigation_accepts_only_plain_https_urls")
$commands.loomLatencyTransport = Invoke-LoggedCommand -Name "loom-latency-transport" -WorkingDirectory $loomRoot `
    -FilePath $cargo -Arguments @("test", "-p", "loom-daemon", "live_media_websocket_fans_out_and_resumes_without_duplicate_frames")
$commands.hookNetworkPrivacy = Invoke-LoggedCommand -Name "hook-network-privacy" -WorkingDirectory $repoRoot `
    -FilePath $cargo -Arguments @("test", "--manifest-path", "src-tauri\Cargo.toml", "live_network_capability_tests")
$commands.hookRuntimeLogPrivacy = Invoke-LoggedCommand -Name "hook-runtime-log-privacy" -WorkingDirectory $repoRoot `
    -FilePath $cargo -Arguments @("test", "--manifest-path", "src-tauri\Cargo.toml", "runtime_log_sanitize_tests")
$commands.hookWebContracts = Invoke-LoggedCommand -Name "hook-web-contracts" -WorkingDirectory $repoRoot -FilePath $npm `
    -Arguments @("test", "--", "__tests__\unit\liveNetworkCapabilities.test.ts", "__tests__\unit\liveRelayInputQos.test.ts", "__tests__\integration\RuntimeLoggingContract.test.ts")
$commands.hookTypecheck = Invoke-LoggedCommand -Name "hook-typecheck" -WorkingDirectory $repoRoot `
    -FilePath $npm -Arguments @("run", "typecheck:test")

$loomRelease = Get-ReleaseEvidence -ReleasePath $LoomReleasePath -ExecutableRelativePath "Loom.exe" -ExpectedApp "Loom"
$hookRelease = Get-ReleaseEvidence -ReleasePath $HookReleasePath -ExecutableRelativePath "portable\hook.exe" -ExpectedApp "Hook"
$checks = [ordered]@{
    lanIndependent = $commands.hookNetworkPrivacy.exitCode -eq 0
    latencyAndCapabilityVisible = $commands.loomLatencyTransport.exitCode -eq 0 -and $commands.hookWebContracts.exitCode -eq 0
    nonLoopbackTlsAndAuthentication = $commands.loomNonLoopbackSecurity.exitCode -eq 0
    pairingRevocationNonceReplay = $commands.loomDeviceReplayRevocation.exitCode -eq 0
    maliciousUrlRejected = $commands.loomUrlSecurity.exitCode -eq 0
    localPrivacyAndRedaction = $commands.hookNetworkPrivacy.exitCode -eq 0 -and $commands.hookRuntimeLogPrivacy.exitCode -eq 0
    hookContractsTypecheck = $commands.hookWebContracts.exitCode -eq 0 -and $commands.hookTypecheck.exitCode -eq 0
    phaseEightUpstreamEvidence = $phaseEightValid
}
$localChecksPassed = @($checks.Values | Where-Object { -not $_ }).Count -eq 0
$externalChecks = [ordered]@{
    publicNatRelayRuntime = $false
    cloudStorageRetentionAudit = $false
    enterpriseAuthorizationRedTeam = $false
    crossDevicePairingRecovery = $false
}
$formalReleaseChecks = [ordered]@{
    loom = [bool]$loomRelease.cleanSource
    hook = [bool]$hookRelease.cleanSource
}
$passed = $localChecksPassed -and
    @($externalChecks.Values | Where-Object { -not $_ }).Count -eq 0 -and
    @($formalReleaseChecks.Values | Where-Object { -not $_ }).Count -eq 0
$result = [ordered]@{
    schemaVersion = 1
    gate = "G9"
    status = if ($passed) { "passed" } else { "partial" }
    scope = "cross-network security, latency, privacy, cloud relay, and formal release readiness"
    passed = $passed
    localChecksPassed = $localChecksPassed
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    checks = $checks
    externalChecks = $externalChecks
    formalReleaseChecks = $formalReleaseChecks
    commands = $commands
    networkClaims = [ordered]@{
        websocketBinary = "available_for_configured_loopback_or_private_https_loom"
        cloudRelay = "unavailable_relay_provider_not_configured"
        webrtcTurn = "unavailable_nat_traversal_not_configured"
        latencyTelemetry = "viewer_websocket_ping_round_trip"
        highLatencyInput = "rtt_adaptive_pointer_coalescing_edges_remain_reliable"
        bandwidthAdaptation = "not_implemented"
    }
    privacyClaims = [ordered]@{
        cloudFramePersistence = $false
        cloudOcrPersistence = $false
        telemetryEnabled = $false
        runtimeLogRedaction = "bounded_generic_secret_and_url_redaction"
        externalCloudAudit = "not_available_without_a_configured_provider"
    }
    blockers = @(
        "No STUN/TURN/SFU or Cloud Relay provider is configured for public NAT traversal.",
        "No external cloud storage plane exists to audit retention and deletion behavior.",
        "Enterprise authorization and cross-network red-team evidence require external infrastructure and devices.",
        "Dirty Loom and Hook source provenance cannot pass formal clean-source release gates."
    )
    releaseEvidence = [ordered]@{ loom = $loomRelease; hook = $hookRelease }
    phaseEightEvidence = [ordered]@{
        path = $phaseEightPath
        sha256 = (Get-FileHash -LiteralPath $phaseEightPath -Algorithm SHA256).Hash.ToLowerInvariant()
        gate = $phaseEight.gate
        passed = [bool]$phaseEight.passed
    }
}
$summaryPath = Join-Path $resolvedOutput "summary.json"
Write-Utf8NoBomJson -Path $summaryPath -Value $result
if (-not $passed -and -not $AllowPartial) {
    throw "Phase 9 G9 is partial. External/cloud/formal-release blockers remain. See $summaryPath"
}
Write-Output $resolvedOutput
