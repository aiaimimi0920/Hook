[CmdletBinding()]
param(
    [string]$HookExe = "",
    [string]$ExpectedSha256 = "",
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
    [string]$ArtLoomWsUrl = "",
    [string]$SurfaceBaseUrl = "",
    [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$hookRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$neuroRoot = [System.IO.Path]::GetFullPath((Join-Path $hookRoot ".."))
if ([string]::IsNullOrWhiteSpace($HookExe)) {
    $HookExe = Join-Path $neuroRoot "release\Hook\20260811-distributed-art-surface-r8\hook.exe"
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

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Content
    )

    $utf8 = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Write-AcceptanceSummary {
    param([Parameter(Mandatory = $true)]$Summary)

    Write-Utf8NoBom -Path $summaryPath -Content (($Summary | ConvertTo-Json -Depth 24) + "`n")
}

function ConvertTo-IsoTime {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }
    try {
        if ($Value -is [DateTime]) {
            return $Value.ToUniversalTime().ToString("o")
        }
        return ([System.Management.ManagementDateTimeConverter]::ToDateTime([string]$Value)).ToUniversalTime().ToString("o")
    }
    catch {
        return [string]$Value
    }
}

function Get-HookProcessRecords {
    $records = @()
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'hook.exe'" -ErrorAction SilentlyContinue)
    foreach ($process in $processes) {
        $role = if ([string]$process.CommandLine -match '--hook-emergency-watchdog') { "watchdog" } else { "main" }
        $records += [pscustomobject][ordered]@{
            processId = [int]$process.ProcessId
            parentProcessId = [int]$process.ParentProcessId
            role = $role
            executablePath = [string]$process.ExecutablePath
            creationTime = ConvertTo-IsoTime $process.CreationDate
        }
    }
    return @($records | Sort-Object processId)
}

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new(
        [System.Net.IPAddress]::Parse("127.0.0.1"),
        0
    )
    $listener.Start()
    try {
        return [int]$listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

function Invoke-JsonGet {
    param([Parameter(Mandatory = $true)][string]$Uri)

    return Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 20
}

function Invoke-JsonPost {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][object]$Body
    )

    return Invoke-RestMethod -Uri $Uri -Method Post -ContentType "application/json" `
        -Body ($Body | ConvertTo-Json -Depth 40 -Compress) -TimeoutSec 30
}

function Wait-HookBridgeSubscriber {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $status = Invoke-JsonGet -Uri "$BaseUrl/v1/hook-bridge/status"
            if ($status.running -eq $true -and [int]$status.subscribedClients -ge 1) {
                return $status
            }
        }
        catch {
            # The packaged daemon may still be accepting its first status request.
        }
        Start-Sleep -Milliseconds 200
    }
    throw "Timed out waiting for Hook to subscribe to the isolated Loom bridge"
}

function Wait-AndApprovePendingHookDevice {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $registry = Invoke-JsonGet -Uri "$BaseUrl/v1/devices"
            $pending = @($registry.pending | Where-Object { $null -ne $_ })
            if ($pending.Count -gt 1) {
                throw "isolated Loom reported multiple pending Hook devices"
            }
            if ($pending.Count -eq 1) {
                $device = $pending[0]
                if (
                    [string]::IsNullOrWhiteSpace([string]$device.id) -or
                    [string]$device.approval -ne "pending" -or
                    $device.isLocal -eq $true -or
                    [string]::IsNullOrWhiteSpace([string]$device.publicKey)
                ) {
                    throw "isolated Loom returned an invalid pending Hook device"
                }
                $encodedDeviceId = [Uri]::EscapeDataString([string]$device.id)
                $approvedRegistry = Invoke-JsonPost -Uri "$BaseUrl/v1/devices/$encodedDeviceId/approve" -Body @{}
                $approved = @($approvedRegistry.devices | Where-Object {
                    [string]$_.id -eq [string]$device.id -and
                    [string]$_.approval -eq "approved" -and
                    $_.enabled -eq $true
                })
                if ($approved.Count -ne 1) {
                    throw "isolated Loom did not confirm the Hook device approval"
                }
                return [ordered]@{
                    deviceId = [string]$device.id
                    initialApproval = [string]$device.approval
                    finalApproval = [string]$approved[0].approval
                    sessionEpoch = [int64]$approved[0].sessionEpoch
                }
            }
        }
        catch {
            if ($_.Exception.Message -like "isolated Loom*") {
                throw
            }
            # Hook may still be creating its device identity and pairing request.
        }
        Start-Sleep -Milliseconds 200
    }
    throw "Timed out waiting for Hook to register its pending Surface device"
}

function Get-PropertyValue {
    param(
        [object]$Object,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($null -eq $Object) {
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Get-PortListenerProcessIds {
    param([Parameter(Mandatory = $true)][int]$Port)

    $processIds = @()
    foreach ($line in @(netstat -ano -p TCP 2>$null)) {
        $parts = @($line -split '\s+' | Where-Object { $_ -ne "" })
        if ($parts.Count -lt 5 -or $parts[0] -ne "TCP" -or $parts[$parts.Count - 2] -ne "LISTENING") {
            continue
        }
        $endpoint = $parts[1]
        $separator = $endpoint.LastIndexOf(":")
        if ($separator -lt 0) {
            continue
        }
        $localPort = 0
        if (-not [int]::TryParse($endpoint.Substring($separator + 1), [ref]$localPort) -or $localPort -ne $Port) {
            continue
        }
        $listenerPid = 0
        [void][int]::TryParse($parts[$parts.Count - 1], [ref]$listenerPid)
        if ($listenerPid -gt 0) {
            $processIds += $listenerPid
        }
    }
    return @($processIds | Sort-Object -Unique)
}

function Get-ProcessTreeIds {
    param([Parameter(Mandatory = $true)][int]$RootProcessId)

    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $childrenByParent = @{}
    foreach ($item in $all) {
        $parent = [int]$item.ParentProcessId
        if (-not $childrenByParent.ContainsKey($parent)) {
            $childrenByParent[$parent] = [System.Collections.Generic.List[int]]::new()
        }
        $childrenByParent[$parent].Add([int]$item.ProcessId)
    }

    $result = [System.Collections.Generic.List[int]]::new()
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $queue.Enqueue($RootProcessId)
    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        if ($result.Contains($current)) {
            continue
        }
        $result.Add($current)
        if ($childrenByParent.ContainsKey($current)) {
            foreach ($child in $childrenByParent[$current]) {
                $queue.Enqueue($child)
            }
        }
    }
    return @($result)
}

function Wait-ForCdp {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "Hook exited before WebView2 CDP became available; exitCode=$($Process.ExitCode)"
        }
        try {
            $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -Method Get -TimeoutSec 2
            if ($version.webSocketDebuggerUrl) {
                return $version
            }
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    throw "Timed out waiting for WebView2 CDP on 127.0.0.1:$Port"
}

function Wait-ForNoPortListener {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (@(Get-PortListenerProcessIds -Port $Port).Count -eq 0) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

function Wait-ForRuntimeLogText {
    param(
        [Parameter(Mandatory = $true)][string]$Needle,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $runtimeLogPath -PathType Leaf) {
            $text = [System.IO.File]::ReadAllText($runtimeLogPath)
            if ($text.Contains($Needle)) {
                return $true
            }
        }
        Start-Sleep -Milliseconds 200
    }
    return $false
}

function Get-RuntimeLogMatchCount {
    param([Parameter(Mandatory = $true)][string]$Needle)

    if (-not (Test-Path -LiteralPath $runtimeLogPath -PathType Leaf)) {
        return 0
    }
    $text = [System.IO.File]::ReadAllText($runtimeLogPath)
    return [regex]::Matches($text, [regex]::Escape($Needle)).Count
}

function Wait-ForRuntimeLogMatchCount {
    param(
        [Parameter(Mandatory = $true)][string]$Needle,
        [Parameter(Mandatory = $true)][int]$MinimumCount,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $count = Get-RuntimeLogMatchCount -Needle $Needle
        if ($count -ge $MinimumCount) {
            return $count
        }
        Start-Sleep -Milliseconds 200
    }
    return (Get-RuntimeLogMatchCount -Needle $Needle)
}

function Invoke-NativeProbe {
    param(
        [Parameter(Mandatory = $true)][int]$DebugPort,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Marker,
        [switch]$PersistSettings,
        [switch]$RequestExit,
        [switch]$SurfaceDashboard
    )

    $resultPath = Join-Path $resolvedArtifactRoot "$Name.json"
    $keys = @(
        "HOOK_ACCEPTANCE_HOOK_ROOT",
        "HOOK_ACCEPTANCE_CDP_URL",
        "HOOK_ACCEPTANCE_RESULT_PATH",
        "HOOK_ACCEPTANCE_MARKER",
        "HOOK_ACCEPTANCE_MODE",
        "HOOK_ACCEPTANCE_PERSIST_SETTINGS",
        "HOOK_ACCEPTANCE_TIMEOUT_MS"
    )
    $oldValues = @{}
    foreach ($key in $keys) {
        $oldValues[$key] = [Environment]::GetEnvironmentVariable($key)
    }

    try {
        $env:HOOK_ACCEPTANCE_HOOK_ROOT = $hookRoot
        $env:HOOK_ACCEPTANCE_CDP_URL = "http://127.0.0.1:$DebugPort"
        $env:HOOK_ACCEPTANCE_RESULT_PATH = $resultPath
        $env:HOOK_ACCEPTANCE_MARKER = $Marker
        $env:HOOK_ACCEPTANCE_MODE = if ($RequestExit) {
            "exit"
        }
        elseif ($SurfaceDashboard) {
            "surface"
        }
        else {
            "probe"
        }
        $env:HOOK_ACCEPTANCE_PERSIST_SETTINGS = if ($PersistSettings) { "1" } else { "0" }
        $env:HOOK_ACCEPTANCE_TIMEOUT_MS = [string]($StartupTimeoutSeconds * 1000)
        & node $probeScriptPath
        $nodeExitCode = $LASTEXITCODE
    }
    finally {
        foreach ($key in $keys) {
            $oldValue = $oldValues[$key]
            if ($null -eq $oldValue) {
                Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue
            }
            else {
                Set-Item -Path "Env:$key" -Value $oldValue
            }
        }
    }

    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
        throw "native probe did not write $resultPath; nodeExitCode=$nodeExitCode"
    }
    $result = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($RequestExit) {
        if ($result.status -ne "exit_requested" -or $result.requested -ne $true) {
            throw "native exit probe failed: $($result | ConvertTo-Json -Depth 8 -Compress)"
        }
    }
    elseif ($nodeExitCode -ne 0 -or $result.status -ne "passed" -or $result.nativeTauriRuntime -ne $true) {
        throw "native probe failed: $($result | ConvertTo-Json -Depth 8 -Compress)"
    }
    return $result
}

function Start-Candidate {
    return Start-Process -FilePath $resolvedExe -WorkingDirectory (Split-Path -Parent $resolvedExe) -PassThru
}

function Stop-SpawnedCandidateOnFailure {
    param([System.Diagnostics.Process]$Process)

    if ($null -eq $Process) {
        return @()
    }
    $stopped = @()
    try {
        $Process.Refresh()
        if (-not $Process.HasExited) {
            $tree = @(Get-ProcessTreeIds -RootProcessId $Process.Id | Sort-Object -Descending)
            foreach ($processId in $tree) {
                $candidate = Get-Process -Id $processId -ErrorAction SilentlyContinue
                if ($null -eq $candidate) {
                    continue
                }
                Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
                $stopped += $processId
            }
        }
    }
    catch {
        return @($stopped)
    }
    return @($stopped)
}

function Invoke-CleanCandidateExit {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][int]$DebugPort,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $marker = "$Name-$runId"
    $cleanupNeedle = "hook_process_exit_cleanup :: reason=tauri_"
    $cleanupCountBefore = Get-RuntimeLogMatchCount -Needle $cleanupNeedle
    $exitProbe = Invoke-NativeProbe -DebugPort $DebugPort -Name "$Name-exit-probe" -Marker $marker -RequestExit
    if (-not $Process.WaitForExit($StartupTimeoutSeconds * 1000)) {
        throw "Hook did not exit after request_native_acceptance_exit"
    }
    if ($Process.ExitCode -ne 0) {
        throw "Hook native acceptance exit code was $($Process.ExitCode), expected 0"
    }
    if (-not (Wait-ForRuntimeLogText -Needle "native_acceptance_exit_requested :: marker=$marker" -TimeoutSeconds 5)) {
        throw "runtime log did not record native_acceptance_exit_requested"
    }
    $cleanupCountAfter = Wait-ForRuntimeLogMatchCount -Needle $cleanupNeedle -MinimumCount ($cleanupCountBefore + 1) -TimeoutSeconds 5
    if ($cleanupCountAfter -le $cleanupCountBefore) {
        throw "runtime log did not record the normal Tauri exit cleanup"
    }
    if (-not (Wait-ForNoPortListener -Port $DebugPort -TimeoutSeconds 15)) {
        throw "WebView2 CDP listener remained after Hook exited"
    }

    $deadline = (Get-Date).AddSeconds(15)
    do {
        $hookProcesses = @(Get-HookProcessRecords)
        if ($hookProcesses.Count -eq 0) {
            break
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    if ($hookProcesses.Count -ne 0) {
        throw "Hook or its emergency watchdog remained after clean exit"
    }

    return [pscustomobject][ordered]@{
        probe = $exitProbe
        exitCode = $Process.ExitCode
        cleanupLogCountBefore = $cleanupCountBefore
        cleanupLogCountAfter = $cleanupCountAfter
        hookProcessesAfterExit = @($hookProcesses)
        debugListenersAfterExit = @(Get-PortListenerProcessIds -Port $DebugPort)
    }
}

function Get-TreeSample {
    param(
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][double]$ElapsedSeconds
    )

    $Process.Refresh()
    if ($Process.HasExited) {
        throw "Hook exited during native candidate soak with code $($Process.ExitCode)"
    }
    $treeIds = @(Get-ProcessTreeIds -RootProcessId $Process.Id)
    $privateBytes = [int64]0
    $workingSetBytes = [int64]0
    $cpuSeconds = 0.0
    $liveIds = @()
    foreach ($processId in $treeIds) {
        $treeProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $treeProcess) {
            continue
        }
        try {
            $privateBytes += [int64]$treeProcess.PrivateMemorySize64
            $workingSetBytes += [int64]$treeProcess.WorkingSet64
            $cpuSeconds += $treeProcess.TotalProcessorTime.TotalSeconds
            $liveIds += $processId
        }
        catch {
            continue
        }
    }
    return [pscustomobject][ordered]@{
        elapsedSeconds = [Math]::Round($ElapsedSeconds, 3)
        processIds = @($liveIds | Sort-Object -Unique)
        privateBytes = $privateBytes
        workingSetBytes = $workingSetBytes
        cpuSeconds = [Math]::Round($cpuSeconds, 4)
    }
}

$debugPort = Get-FreeTcpPort
do {
    $isolatedArtLoomPort = Get-FreeTcpPort
} while ($isolatedArtLoomPort -eq $debugPort)
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
        expectedSha256 = if ([string]::IsNullOrWhiteSpace($ExpectedSha256)) { $null } else { $ExpectedSha256.ToLowerInvariant() }
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
        artLoomEnabled = $RequireSurfaceDashboard.IsPresent
        requireSurfaceDashboard = $RequireSurfaceDashboard.IsPresent
        loomManifestPath = $resolvedLoomManifestPath
        artLoomWsUrl = if ([string]::IsNullOrWhiteSpace($ArtLoomWsUrl)) { $null } else { $ArtLoomWsUrl }
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
    "HOOK_ENABLE_ARTLOOM",
    "HOOK_NATIVE_ACCEPTANCE",
    "HOOK_TEA_INTAKE_ENABLED",
    "LOOM_MANIFEST_PATH",
    "ARTLOOM_WS_URL",
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
    if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256) -and $actualSha256 -ne $ExpectedSha256.Trim().ToLowerInvariant()) {
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
        if ($ArtLoomWsUrl -notmatch '^ws://127\.0\.0\.1:\d+$') {
            throw "RequireSurfaceDashboard needs a loopback ArtLoomWsUrl"
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
    $env:HOOK_ENABLE_ARTLOOM = if ($RequireSurfaceDashboard) { "1" } else { "0" }
    $env:HOOK_NATIVE_ACCEPTANCE = "1"
    $env:HOOK_TEA_INTAKE_ENABLED = "0"
    $env:APPDATA = $windowsAppDataDir
    $env:LOCALAPPDATA = $windowsLocalAppDataDir
    if ($RequireSurfaceDashboard) {
        $env:LOOM_MANIFEST_PATH = $resolvedLoomManifestPath
        $env:ARTLOOM_WS_URL = $ArtLoomWsUrl
    }
    else {
        $env:LOOM_MANIFEST_PATH = Join-Path $resolvedArtifactRoot "missing-loom.json"
        $env:ARTLOOM_WS_URL = "ws://127.0.0.1:$isolatedArtLoomPort"
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
    $expectedArtLoomEnabled = $RequireSurfaceDashboard.IsPresent
    if ($firstProbe.bootProfile.startupMode -ne "visible" -or $firstProbe.bootProfile.initialUiMode -ne "canvas" -or $firstProbe.bootProfile.artLoomEnabled -ne $expectedArtLoomEnabled) {
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
                    type = "art"
                    position = @{ x = 100; y = 100 }
                    data = @{
                        artId = "surface-device-dashboard"
                        w = 480
                        h = 520
                    }
                }
            )
            edges = @()
            mode = "reference"
            workflowId = $workflowId
        }
        $instantiated = Invoke-JsonPost -Uri "$SurfaceBaseUrl/v1/artloom-compat/ipc/instantiate-workflow" -Body $workflowPayload
        if ([string]$instantiated.method -ne "art_hook/instantiate") {
            throw "isolated Loom did not broadcast art_hook/instantiate"
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
        if (-not (Wait-ForRuntimeLogText -Needle "artloom_dispatch_surface_attach" -TimeoutSeconds 10)) {
            throw "Hook runtime log did not record the real Surface attach"
        }
        if (-not (Wait-ForRuntimeLogText -Needle "artloom_dispatch_surface_event" -TimeoutSeconds 10)) {
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
