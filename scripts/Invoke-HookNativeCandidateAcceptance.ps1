[CmdletBinding()]
param(
    [string]$HookExe = "",
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedSha256 = "9f514b1a61f21bd337e40dd890f471c8cba400cde29c3a2e85a717baa148b72b",
    [ValidateRange(60, 86400)]
    [int]$DurationSeconds = 600,
    [ValidateRange(0, 3600)]
    [int]$WarmupSeconds = 30,
    [ValidateRange(250, 60000)]
    [int]$SampleIntervalMs = 1000,
    [ValidateRange(1, 4096)]
    [int]$MaxPrivateGrowthMb = 256,
    [ValidateRange(0, 1000)]
    [double]$MaxPrivateGrowthPercent = 25,
    [ValidateRange(10, 600)]
    [int]$StartupTimeoutSeconds = 90,
    [string]$ArtifactRoot = "",
    [switch]$RequireSurfaceDashboard,
    [string]$LoomManifestPath = "",
    [string]$LoomHookWsUrl = "",
    [string]$SurfaceBaseUrl = "",
    [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$hookRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$neuroRoot = [System.IO.Path]::GetFullPath((Join-Path $hookRoot ".."))
if ([string]::IsNullOrWhiteSpace($HookExe)) {
    $HookExe = Join-Path $neuroRoot "release\Hook\20260814-image-search-runtime-fix-r18\hook.exe"
}
$resolvedExe = [System.IO.Path]::GetFullPath($HookExe)
$resolvedLoomManifestPath = if ([string]::IsNullOrWhiteSpace($LoomManifestPath)) {
    $null
} else {
    [System.IO.Path]::GetFullPath($LoomManifestPath)
}

if ($WarmupSeconds -ge $DurationSeconds) {
    throw "WarmupSeconds must be smaller than DurationSeconds."
}

$runId = "{0}-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), ([Guid]::NewGuid().ToString("N").Substring(0, 12))
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $hookRoot "artifacts\runtime-performance\hook-native-candidate\$runId"
}
$resolvedArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)
$summaryPath = Join-Path $resolvedArtifactRoot "summary.json"
$appDataDir = Join-Path $resolvedArtifactRoot "appdata"
$windowsAppDataDir = Join-Path $resolvedArtifactRoot "windows-appdata"
$windowsLocalAppDataDir = Join-Path $resolvedArtifactRoot "windows-localappdata"
$runtimeLogDir = Join-Path $resolvedArtifactRoot "logs"
$runtimeLogPath = Join-Path $runtimeLogDir "hook-runtime.log"
$webview2UserDataDir = Join-Path $resolvedArtifactRoot "webview2"
$probeScriptPath = Join-Path $PSScriptRoot "hook-native-candidate-probe.mjs"

New-Item -ItemType Directory -Path $resolvedArtifactRoot -Force | Out-Null


# Dot-source lexical owners so existing function scope and exit behavior remain unchanged.
$acceptanceOwnersDir = Join-Path $PSScriptRoot "native-candidate-acceptance"
. (Join-Path $acceptanceOwnersDir "summary-process-wait.ps1")
. (Join-Path $acceptanceOwnersDir "probe-lifecycle.ps1")

$debugPort = Get-FreeTcpPort
do {
    $isolatedLoomHookPort = Get-FreeTcpPort
} while ($isolatedLoomHookPort -eq $debugPort)
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$playwrightPackage = Join-Path $hookRoot "node_modules\playwright\package.json"
$hookProcessesBefore = @(Get-HookProcessRecords)
$debugListenersBefore = @(Get-PortListenerProcessIds -Port $debugPort)
$summary = [ordered]@{
    schemaVersion = 1
    runId = $runId
    status = "preflight"
    passed = $false
    startedAt = [DateTimeOffset]::UtcNow.ToString("o")
    finishedAt = $null
    executable = [ordered]@{
        path = $resolvedExe
        exists = [bool](Test-Path -LiteralPath $resolvedExe -PathType Leaf)
        length = $null
        sha256 = $null
        expectedSha256 = $ExpectedSha256.ToLowerInvariant()
    }
    configuration = [ordered]@{
        durationSeconds = $DurationSeconds
        warmupSeconds = $WarmupSeconds
        sampleIntervalMs = $SampleIntervalMs
        maxPrivateGrowthMb = $MaxPrivateGrowthMb
        maxPrivateGrowthPercent = $MaxPrivateGrowthPercent
        startupTimeoutSeconds = $StartupTimeoutSeconds
        debugPort = $debugPort
        appDataDir = $appDataDir
        runtimeLogDir = $runtimeLogDir
        webview2UserDataDir = $webview2UserDataDir
        loomHookEnabled = $RequireSurfaceDashboard.IsPresent
        requireSurfaceDashboard = $RequireSurfaceDashboard.IsPresent
        loomManifestPath = $resolvedLoomManifestPath
        loomHookWsUrl = if ([string]::IsNullOrWhiteSpace($LoomHookWsUrl)) { $null } else { $LoomHookWsUrl }
        surfaceBaseUrl = if ([string]::IsNullOrWhiteSpace($SurfaceBaseUrl)) { $null } else { $SurfaceBaseUrl }
        nativeAcceptanceExitEnabled = $true
    }
    preflight = [ordered]@{
        nodePath = if ($null -eq $nodeCommand) { $null } else { $nodeCommand.Source }
        playwrightPackage = $playwrightPackage
        playwrightExists = [bool](Test-Path -LiteralPath $playwrightPackage -PathType Leaf)
        probeScript = $probeScriptPath
        probeScriptExists = [bool](Test-Path -LiteralPath $probeScriptPath -PathType Leaf)
        hookProcessesBefore = @($hookProcessesBefore)
        debugListenersBefore = @($debugListenersBefore)
        ready = $false
    }
    phases = [ordered]@{}
    forcedCleanupProcessIds = @()
    error = $null
}

$firstProcess = $null
$restartProcess = $null
$secondProcess = $null
$oldEnv = @{}
$managedEnvKeys = @(
    "HOOK_APPDATA_DIR",
    "HOOK_LOG_DIR",
    "HOOK_STARTUP_MODE",
    "HOOK_INITIAL_UI_MODE",
    "HOOK_AUTOSTART_CAPTURE",
    "HOOK_ENABLE_LOOM_HOOK",
    "HOOK_NATIVE_ACCEPTANCE",
    "HOOK_TEA_INTAKE_ENABLED",
    "LOOM_MANIFEST_PATH",
    "LOOM_HOOK_WS_URL",
    "APPDATA",
    "LOCALAPPDATA",
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "WEBVIEW2_USER_DATA_FOLDER"
)

try {
    if (-not $summary.executable.exists) {
        throw "Hook candidate executable does not exist: $resolvedExe"
    }
    $file = Get-Item -LiteralPath $resolvedExe
    $actualSha256 = (Get-FileHash -LiteralPath $resolvedExe -Algorithm SHA256).Hash.ToLowerInvariant()
    $summary.executable.length = [int64]$file.Length
    $summary.executable.sha256 = $actualSha256
    if ($actualSha256 -ne $ExpectedSha256.Trim().ToLowerInvariant()) {
        throw "Hook candidate SHA-256 mismatch: expected=$ExpectedSha256 actual=$actualSha256"
    }
    if ($null -eq $nodeCommand) {
        throw "node is not available on PATH"
    }
    if (-not $summary.preflight.playwrightExists) {
        throw "Hook Playwright dependency is missing: $playwrightPackage"
    }
    if (-not $summary.preflight.probeScriptExists) {
        throw "Hook native candidate probe is missing: $probeScriptPath"
    }
    if ($debugListenersBefore.Count -ne 0) {
        throw "selected CDP port already has listeners: $($debugListenersBefore -join ',')"
    }
    if ($RequireSurfaceDashboard) {
        if ($null -eq $resolvedLoomManifestPath -or -not (Test-Path -LiteralPath $resolvedLoomManifestPath -PathType Leaf)) {
            throw "RequireSurfaceDashboard needs an existing LoomManifestPath"
        }
        if ($LoomHookWsUrl -notmatch '^ws://127\.0\.0\.1:\d+$') {
            throw "RequireSurfaceDashboard needs a loopback LoomHookWsUrl"
        }
        if ($SurfaceBaseUrl -notmatch '^http://127\.0\.0\.1:\d+$') {
            throw "RequireSurfaceDashboard needs a loopback SurfaceBaseUrl"
        }
    }

    $summary.preflight.ready = ($hookProcessesBefore.Count -eq 0)
    if ($PreflightOnly) {
        $summary.status = if ($summary.preflight.ready) { "preflight_ready" } else { "blocked_existing_hook" }
        $summary.finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
        Write-AcceptanceSummary -Summary $summary
        Write-Host "[hook-native-candidate] $($summary.status): $summaryPath"
        return
    }
    if ($hookProcessesBefore.Count -ne 0) {
        throw "Refusing to launch Hook candidate while another Hook main/watchdog process exists. Exit the existing Hook normally and retry."
    }

    New-Item -ItemType Directory -Path $appDataDir -Force | Out-Null
    New-Item -ItemType Directory -Path $windowsAppDataDir -Force | Out-Null
    New-Item -ItemType Directory -Path $windowsLocalAppDataDir -Force | Out-Null
    New-Item -ItemType Directory -Path $runtimeLogDir -Force | Out-Null
    New-Item -ItemType Directory -Path $webview2UserDataDir -Force | Out-Null

    foreach ($key in $managedEnvKeys) {
        $oldEnv[$key] = [Environment]::GetEnvironmentVariable($key)
    }
    $env:HOOK_APPDATA_DIR = $appDataDir
    $env:HOOK_LOG_DIR = $runtimeLogDir
    $env:HOOK_STARTUP_MODE = "visible"
    $env:HOOK_INITIAL_UI_MODE = "canvas"
    $env:HOOK_AUTOSTART_CAPTURE = "0"
    $env:HOOK_ENABLE_LOOM_HOOK = if ($RequireSurfaceDashboard) { "1" } else { "0" }
    $env:HOOK_NATIVE_ACCEPTANCE = "1"
    $env:HOOK_TEA_INTAKE_ENABLED = "0"
    $env:APPDATA = $windowsAppDataDir
    $env:LOCALAPPDATA = $windowsLocalAppDataDir
    if ($RequireSurfaceDashboard) {
        $env:LOOM_MANIFEST_PATH = $resolvedLoomManifestPath
        $env:LOOM_HOOK_WS_URL = $LoomHookWsUrl
    }
    else {
        $env:LOOM_MANIFEST_PATH = Join-Path $resolvedArtifactRoot "missing-loom.json"
        $env:LOOM_HOOK_WS_URL = "ws://127.0.0.1:$isolatedLoomHookPort"
    }
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$debugPort --remote-allow-origins=*"
    $env:WEBVIEW2_USER_DATA_FOLDER = $webview2UserDataDir

    $summary.status = "first_launch"
    Write-AcceptanceSummary -Summary $summary
    $firstProcess = Start-Candidate
    $firstCdp = Wait-ForCdp -Port $debugPort -Process $firstProcess -TimeoutSeconds $StartupTimeoutSeconds
    if ($RequireSurfaceDashboard -and -not (Wait-ForRuntimeLogText -Needle "frontend-initialized" -TimeoutSeconds $StartupTimeoutSeconds)) {
        throw "Hook frontend did not finish listener/capability/session initialization"
    }
    $firstMarker = "first-launch-$runId"
    $firstProbe = Invoke-NativeProbe -DebugPort $debugPort -Name "first-launch-probe" -Marker $firstMarker -PersistSettings
    $expectedLoomHookEnabled = $RequireSurfaceDashboard.IsPresent
    if ($firstProbe.bootProfile.startupMode -ne "visible" -or $firstProbe.bootProfile.initialUiMode -ne "canvas" -or $firstProbe.bootProfile.loomHookEnabled -ne $expectedLoomHookEnabled) {
        throw "first native probe returned an unexpected boot profile"
    }
    if (-not (Wait-ForRuntimeLogText -Needle "native-acceptance-probe :: $firstMarker" -TimeoutSeconds 10)) {
        throw "first native IPC probe marker did not reach the runtime log"
    }
    $summary.phases.firstLaunch = [ordered]@{
        processId = $firstProcess.Id
        cdpVersion = $firstCdp
        probe = $firstProbe
        hookProcesses = @(Get-HookProcessRecords)
    }

    $summary.status = "single_instance"
    Write-AcceptanceSummary -Summary $summary
    $secondProcess = Start-Candidate
    if (-not $secondProcess.WaitForExit(15000)) {
        throw "second Hook candidate process did not exit under the global single-instance mutex"
    }
    $firstProcess.Refresh()
    if ($firstProcess.HasExited) {
        throw "first Hook candidate exited while testing the second-instance refusal"
    }
    $mainProcessesAfterSecond = @(Get-HookProcessRecords | Where-Object { $_.role -eq "main" })
    if ($secondProcess.ExitCode -ne 0 -or $mainProcessesAfterSecond.Count -ne 1 -or $mainProcessesAfterSecond[0].processId -ne $firstProcess.Id) {
        throw "global single-instance behavior was not preserved"
    }
    $afterSecondMarker = "after-second-instance-$runId"
    $afterSecondProbe = Invoke-NativeProbe -DebugPort $debugPort -Name "after-second-instance-probe" -Marker $afterSecondMarker
    $summary.phases.singleInstance = [ordered]@{
        attemptedProcessId = $secondProcess.Id
        exitCode = $secondProcess.ExitCode
        survivingMainProcessId = $firstProcess.Id
        mainProcessesAfterAttempt = @($mainProcessesAfterSecond)
        responsivenessProbe = $afterSecondProbe
    }
    $secondProcess.Dispose()
    $secondProcess = $null

    if ($RequireSurfaceDashboard) {
        $summary.status = "dual_end_surface"
        Write-AcceptanceSummary -Summary $summary
        $bridgeStatus = Wait-HookBridgeSubscriber -BaseUrl $SurfaceBaseUrl -TimeoutSeconds $StartupTimeoutSeconds
        $workflowId = "hook-native-surface-$runId"
        $originNodeId = "dashboard-$runId"
        $workflowPayload = @{
            nodes = @(
                @{
                    id = $originNodeId
                    type = "artNode"
                    position = @{ x = 100; y = 100 }
                    data = @{
                        # Hook bridge capability ids are publisher-qualified. The
                        # package's local id is only used by Loom's install/store APIs.
                        artId = "neuro.official/surface-device-dashboard"
                        w = 480
                        h = 520
                    }
                }
            )
            edges = @()
            mode = "reference"
            workflowId = $workflowId
        }
        $instantiated = Invoke-JsonPost -Uri "$SurfaceBaseUrl/v1/hook-bridge/workflows/instantiate" -Body $workflowPayload
        if ([string]$instantiated.protocolVersion -ne "loom.hook.v1" -or
            [string]$instantiated.method -ne "loom.hook.workflow.instantiated") {
            throw "isolated Loom did not broadcast loom.hook.workflow.instantiated"
        }
        $pairing = Wait-AndApprovePendingHookDevice -BaseUrl $SurfaceBaseUrl -TimeoutSeconds $StartupTimeoutSeconds

        $surfaceMarker = "surface-dashboard-$runId"
        $surfaceProbe = Invoke-NativeProbe -DebugPort $debugPort -Name "surface-dashboard-probe" `
            -Marker $surfaceMarker -SurfaceDashboard
        $surface = $surfaceProbe.surface
        if ($null -eq $surface -or $surface.chartDataUrl -ne $true -or [int64]$surface.afterRevision -le [int64]$surface.beforeRevision) {
            throw "Hook did not render and update the packaged Loom dashboard Surface"
        }
        $surfaceRecord = Invoke-JsonGet -Uri "$SurfaceBaseUrl/v1/surfaces/instances/$($surface.instanceId)"
        $attachment = Get-PropertyValue -Object $surfaceRecord.attachments -Name ([string]$surface.attachmentId)
        if ($null -eq $attachment) {
            throw "isolated Loom has no attachment matching the Hook-rendered Surface"
        }
        if ([int64]$attachment.snapshot.revision -ne [int64]$surface.afterRevision) {
            throw "Hook and Loom dashboard Surface revisions diverged"
        }
        if ([string]$attachment.snapshot.authoritativeState.status -ne "ready") {
            throw "dashboard Surface authoritative state did not reach ready"
        }
        if ([string]$surfaceRecord.latestResult.outputs.dashboard.value.status -ne "ready") {
            throw "dashboard Surface formal result did not reach ready"
        }
        $eventAcks = @($surfaceRecord.eventAcks.PSObject.Properties | ForEach-Object { $_.Value })
        if (@($eventAcks | Where-Object { [string]$_.status -eq "succeeded" }).Count -lt 1) {
            throw "isolated Loom did not record a succeeded event ACK for the Hook click"
        }
        if (-not (Wait-ForRuntimeLogText -Needle "loom_hook_dispatch_surface_attach" -TimeoutSeconds 10)) {
            throw "Hook runtime log did not record the real Surface attach"
        }
        if (-not (Wait-ForRuntimeLogText -Needle "loom_hook_dispatch_surface_event" -TimeoutSeconds 10)) {
            throw "Hook runtime log did not record the real Surface event"
        }
        $summary.phases.dualEndSurface = [ordered]@{
            bridgeStatus = $bridgeStatus
            pairing = $pairing
            instantiateResponse = $instantiated
            workflowId = $workflowId
            originNodeId = $originNodeId
            probe = $surfaceProbe
            daemonRecord = $surfaceRecord
            succeededEventAckCount = @($eventAcks | Where-Object { [string]$_.status -eq "succeeded" }).Count
        }
    }

    $summary.status = "soak"
    Write-AcceptanceSummary -Summary $summary
    $samples = [System.Collections.Generic.List[object]]::new()
    $soakStartedAt = [DateTimeOffset]::UtcNow
    while (([DateTimeOffset]::UtcNow - $soakStartedAt).TotalSeconds -lt $DurationSeconds) {
        $elapsed = ([DateTimeOffset]::UtcNow - $soakStartedAt).TotalSeconds
        $samples.Add((Get-TreeSample -Process $firstProcess -ElapsedSeconds $elapsed))
        Start-Sleep -Milliseconds $SampleIntervalMs
    }
    $postWarmup = @($samples | Where-Object { $_.elapsedSeconds -ge $WarmupSeconds })
    if ($postWarmup.Count -lt 2) {
        throw "native candidate soak did not collect enough post-warmup samples"
    }
    $baselinePrivate = [int64]$postWarmup[0].privateBytes
    $finalPrivate = [int64]$postWarmup[-1].privateBytes
    $peakPrivate = [int64](($postWarmup | Measure-Object -Property privateBytes -Maximum).Maximum)
    $privateGrowth = [Math]::Max([int64]0, $finalPrivate - $baselinePrivate)
    $privateGrowthPercent = if ($baselinePrivate -gt 0) { ($privateGrowth / $baselinePrivate) * 100 } else { 0 }
    $violations = [System.Collections.Generic.List[string]]::new()
    if ($privateGrowth -gt ($MaxPrivateGrowthMb * 1MB)) {
        $violations.Add("process-tree private memory growth exceeded ${MaxPrivateGrowthMb}MB")
    }
    if ($privateGrowthPercent -gt $MaxPrivateGrowthPercent) {
        $violations.Add("process-tree private memory growth exceeded $MaxPrivateGrowthPercent percent")
    }
    $endMarker = "soak-end-$runId"
    $endProbe = Invoke-NativeProbe -DebugPort $debugPort -Name "soak-end-probe" -Marker $endMarker
    $summary.phases.soak = [ordered]@{
        durationSeconds = $DurationSeconds
        sampleCount = $samples.Count
        baselinePrivateBytes = $baselinePrivate
        finalPrivateBytes = $finalPrivate
        peakPrivateBytes = $peakPrivate
        growthBytes = [int64]$privateGrowth
        growthPercent = [Math]::Round($privateGrowthPercent, 3)
        violations = @($violations)
        responsivenessProbe = $endProbe
        samples = @($samples)
    }
    if ($violations.Count -gt 0) {
        throw "native candidate soak failed: $($violations -join '; ')"
    }

    $summary.status = "first_clean_exit"
    Write-AcceptanceSummary -Summary $summary
    $summary.phases.firstCleanExit = Invoke-CleanCandidateExit -Process $firstProcess -DebugPort $debugPort -Name "first"
    $firstProcess.Dispose()
    $firstProcess = $null

    $summary.status = "restart"
    Write-AcceptanceSummary -Summary $summary
    $frontendInitializedCountBeforeRestart = Get-RuntimeLogMatchCount -Needle "frontend-initialized"
    $restartProcess = Start-Candidate
    $restartCdp = Wait-ForCdp -Port $debugPort -Process $restartProcess -TimeoutSeconds $StartupTimeoutSeconds
    if ($RequireSurfaceDashboard) {
        $frontendInitializedCountAfterRestart = Wait-ForRuntimeLogMatchCount -Needle "frontend-initialized" `
            -MinimumCount ($frontendInitializedCountBeforeRestart + 1) -TimeoutSeconds $StartupTimeoutSeconds
        if ($frontendInitializedCountAfterRestart -le $frontendInitializedCountBeforeRestart) {
            throw "Hook frontend did not complete initialization after process restart"
        }
    }
    $restartMarker = "restart-$runId"
    $restartProbe = Invoke-NativeProbe -DebugPort $debugPort -Name "restart-probe" -Marker $restartMarker
    $firstSettingsJson = $firstProbe.appSettings | ConvertTo-Json -Depth 20 -Compress
    $restartSettingsJson = $restartProbe.appSettings | ConvertTo-Json -Depth 20 -Compress
    $settingsPersisted = $firstSettingsJson -eq $restartSettingsJson
    if (-not $settingsPersisted) {
        throw "isolated Hook app settings did not survive the native process restart"
    }
    $restartSurfaceProbe = $null
    $restartSurfaceRecord = $null
    if ($RequireSurfaceDashboard) {
        [void](Wait-HookBridgeSubscriber -BaseUrl $SurfaceBaseUrl -TimeoutSeconds $StartupTimeoutSeconds)
        $restartSurfaceMarker = "restart-surface-$runId"
        $restartSurfaceProbe = Invoke-NativeProbe -DebugPort $debugPort -Name "restart-surface-probe" `
            -Marker $restartSurfaceMarker -SurfaceDashboard
        if ([string]$restartSurfaceProbe.surface.instanceId -ne [string]$surface.instanceId) {
            throw "Hook restart did not recover the persistent shared Surface instance"
        }
        if ($restartSurfaceProbe.surface.chartDataUrl -ne $true) {
            throw "Hook restart did not recover and resolve the dashboard resource"
        }
        $restartSurfaceRecord = Invoke-JsonGet -Uri "$SurfaceBaseUrl/v1/surfaces/instances/$($surface.instanceId)"
        if ([string]$restartSurfaceRecord.latestResult.outputs.dashboard.value.status -ne "ready") {
            throw "dashboard formal result was not preserved after Hook restart"
        }
    }
    $summary.phases.restart = [ordered]@{
        processId = $restartProcess.Id
        cdpVersion = $restartCdp
        probe = $restartProbe
        settingsPersisted = $settingsPersisted
        surfaceProbe = $restartSurfaceProbe
        surfaceDaemonRecord = $restartSurfaceRecord
        hookProcesses = @(Get-HookProcessRecords)
    }

    $summary.status = "restart_clean_exit"
    Write-AcceptanceSummary -Summary $summary
    $summary.phases.restartCleanExit = Invoke-CleanCandidateExit -Process $restartProcess -DebugPort $debugPort -Name "restart"
    $restartProcess.Dispose()
    $restartProcess = $null

    $summary.status = "passed"
    $summary.passed = $true
    $summary.finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
    Write-AcceptanceSummary -Summary $summary
    Write-Host "[hook-native-candidate] Passed: $summaryPath"
}
catch {
    $summary.status = "failed"
    $summary.error = $_.Exception.Message
    $summary.finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
    $forced = @()
    $forced += @(Stop-SpawnedCandidateOnFailure -Process $secondProcess)
    $forced += @(Stop-SpawnedCandidateOnFailure -Process $restartProcess)
    $forced += @(Stop-SpawnedCandidateOnFailure -Process $firstProcess)
    $summary.forcedCleanupProcessIds = @($forced | Sort-Object -Unique)
    Write-AcceptanceSummary -Summary $summary
    throw
}
finally {
    foreach ($process in @($secondProcess, $restartProcess, $firstProcess)) {
        if ($null -ne $process) {
            $process.Dispose()
        }
    }
    foreach ($key in $managedEnvKeys) {
        if (-not $oldEnv.ContainsKey($key)) {
            continue
        }
        $oldValue = $oldEnv[$key]
        if ($null -eq $oldValue) {
            Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item -Path "Env:$key" -Value $oldValue
        }
    }
}
