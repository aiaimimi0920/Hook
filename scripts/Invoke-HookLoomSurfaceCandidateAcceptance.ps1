[CmdletBinding()]
param(
    [string]$HookExe = "",
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedHookSha256 = "b12f107f32924db7498cb20f7a69ca926481f08da996b236e90f50b2a7cb894e",
    [string]$LoomPackageDir = "",
    [ValidatePattern('^[0-9A-Fa-f]{64}$')]
    [string]$ExpectedLoomDaemonSha256 = "8157b1086580eaca22b0a1764f367f32c966b956509937a7cebf6b3ec0b07293",
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
    [switch]$ValidateLoomServicesOnly,
    [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$hookRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$neuroRoot = [System.IO.Path]::GetFullPath((Join-Path $hookRoot ".."))
$loomRepoRoot = Join-Path $neuroRoot "Loom"
if ([string]::IsNullOrWhiteSpace($HookExe)) {
    $HookExe = Join-Path $neuroRoot "release\Hook\20260814-art-protocol-review-r17\hook.exe"
}
if ([string]::IsNullOrWhiteSpace($LoomPackageDir)) {
    $LoomPackageDir = Join-Path $neuroRoot "release\Loom\20260814-packaged-image-search-mcp-r27"
}
$resolvedHookExe = [System.IO.Path]::GetFullPath($HookExe)
$resolvedLoomPackageDir = [System.IO.Path]::GetFullPath($LoomPackageDir)
$loomDaemonExe = Join-Path $resolvedLoomPackageDir "runtime\loom-daemon.exe"
$artStoreExe = Join-Path $loomRepoRoot "target\release\loom-art-store.exe"
$processFrameworkZip = Join-Path $loomRepoRoot "target\surface-smoke-frameworks\process.zip"
$dashboardArtZip = Join-Path $loomRepoRoot "target\surface-smoke-arts\surface-prototype-dashboard.zip"
$innerScript = Join-Path $PSScriptRoot "Invoke-HookNativeCandidateAcceptance.ps1"

$runId = "{0}-hook-loom-surface-{1}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), ([Guid]::NewGuid().ToString("N").Substring(0, 12))
if ([string]::IsNullOrWhiteSpace($ArtifactRoot)) {
    $ArtifactRoot = Join-Path $hookRoot "artifacts\runtime-performance\hook-loom-surface-candidate\$runId"
}
$resolvedArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)
$summaryPath = Join-Path $resolvedArtifactRoot "summary.json"
$serviceRoot = Join-Path $resolvedArtifactRoot "isolated-loom"
$storeRoot = Join-Path $serviceRoot "store"
$controlPlaneRoot = Join-Path $serviceRoot "control-plane"
$appDataRoot = Join-Path $serviceRoot "appdata"
$localAppDataRoot = Join-Path $serviceRoot "localappdata"
$manifestDir = Join-Path $serviceRoot "capabilities"
$logsRoot = Join-Path $serviceRoot "logs"
$innerArtifactRoot = Join-Path $resolvedArtifactRoot "hook-native"
$innerSummaryPath = Join-Path $innerArtifactRoot "summary.json"

New-Item -ItemType Directory -Path $resolvedArtifactRoot -Force | Out-Null

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )

    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Write-Summary {
    param([Parameter(Mandatory = $true)]$Summary)

    Write-Utf8NoBom -Path $summaryPath -Content (($Summary | ConvertTo-Json -Depth 30) + "`n")
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

function Get-UniqueFreePorts {
    param([Parameter(Mandatory = $true)][int]$Count)

    $ports = [System.Collections.Generic.List[int]]::new()
    while ($ports.Count -lt $Count) {
        $port = Get-FreeTcpPort
        if (-not $ports.Contains($port)) {
            $ports.Add($port)
        }
    }
    return @($ports)
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

function Get-LiveHookProcesses {
    return @(Get-CimInstance Win32_Process -Filter "Name = 'hook.exe'" -ErrorAction SilentlyContinue | ForEach-Object {
        [pscustomobject][ordered]@{
            processId = [int]$_.ProcessId
            parentProcessId = [int]$_.ParentProcessId
            role = if ([string]$_.CommandLine -match '--hook-emergency-watchdog') { "watchdog" } else { "main" }
            executablePath = [string]$_.ExecutablePath
        }
    })
}

function Start-InheritedEnvironmentProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][hashtable]$Environment,
        [Parameter(Mandatory = $true)][string]$StdoutPath,
        [Parameter(Mandatory = $true)][string]$StderrPath
    )

    $previous = @{}
    foreach ($entry in $Environment.GetEnumerator()) {
        $previous[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key)
        [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value)
    }
    try {
        return Start-Process -FilePath $FilePath -WorkingDirectory $WorkingDirectory `
            -RedirectStandardOutput $StdoutPath -RedirectStandardError $StderrPath `
            -WindowStyle Hidden -PassThru
    }
    finally {
        foreach ($entry in $previous.GetEnumerator()) {
            [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value)
        }
    }
}

function Stop-OwnedProcess {
    param([System.Diagnostics.Process]$Process)

    if ($null -eq $Process) {
        return $true
    }
    try {
        $Process.Refresh()
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
            [void]$Process.WaitForExit(10000)
        }
        return $Process.HasExited
    }
    finally {
        $Process.Dispose()
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

function Wait-Http {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "process $($Process.Id) exited while waiting for $Uri; exitCode=$($Process.ExitCode)"
        }
        try {
            return Invoke-JsonGet -Uri $Uri
        }
        catch {
            Start-Sleep -Milliseconds 200
        }
    }
    throw "Timed out waiting for $Uri"
}

function Get-FileEvidence {
    param([Parameter(Mandatory = $true)][string]$Path)

    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        path = $item.FullName
        length = [int64]$item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$ports = @(Get-UniqueFreePorts -Count 3)
$storePort = $ports[0]
$daemonPort = $ports[1]
$bridgePort = $ports[2]
$storeBaseUrl = "http://127.0.0.1:$storePort"
$daemonBaseUrl = "http://127.0.0.1:$daemonPort"
$bridgeWsUrl = "ws://127.0.0.1:$bridgePort"
$hookProcessesBefore = @(Get-LiveHookProcesses)

$summary = [ordered]@{
    schemaVersion = 1
    runId = $runId
    status = "preflight"
    passed = $false
    startedAt = [DateTimeOffset]::UtcNow.ToString("o")
    finishedAt = $null
    configuration = [ordered]@{
        durationSeconds = $DurationSeconds
        warmupSeconds = $WarmupSeconds
        sampleIntervalMs = $SampleIntervalMs
        maxPrivateGrowthMb = $MaxPrivateGrowthMb
        maxPrivateGrowthPercent = $MaxPrivateGrowthPercent
        startupTimeoutSeconds = $StartupTimeoutSeconds
        storePort = $storePort
        daemonPort = $daemonPort
        bridgePort = $bridgePort
        isolatedControlPlane = $true
    }
    files = [ordered]@{}
    preflight = [ordered]@{
        hookProcessesBefore = @($hookProcessesBefore)
        selectedPortListeners = @{
            store = @(Get-PortListenerProcessIds -Port $storePort)
            daemon = @(Get-PortListenerProcessIds -Port $daemonPort)
            bridge = @(Get-PortListenerProcessIds -Port $bridgePort)
        }
        ready = $false
    }
    serviceProcesses = [ordered]@{}
    install = [ordered]@{}
    innerSummaryPath = $innerSummaryPath
    innerSummary = $null
    cleanup = [ordered]@{}
    error = $null
}

$storeProcess = $null
$daemonProcess = $null
$servicesStarted = $false

try {
    if ($PreflightOnly -and $ValidateLoomServicesOnly) {
        throw "PreflightOnly and ValidateLoomServicesOnly cannot be combined"
    }
    foreach ($required in @(
        $resolvedHookExe,
        $loomDaemonExe,
        $artStoreExe,
        $processFrameworkZip,
        $dashboardArtZip,
        $innerScript
    )) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "required dual-end acceptance file is missing: $required"
        }
    }

    $summary.files.hook = Get-FileEvidence -Path $resolvedHookExe
    $summary.files.loomDaemon = Get-FileEvidence -Path $loomDaemonExe
    $summary.files.artStoreFixture = Get-FileEvidence -Path $artStoreExe
    $summary.files.processFrameworkFixture = Get-FileEvidence -Path $processFrameworkZip
    $summary.files.dashboardArtFixture = Get-FileEvidence -Path $dashboardArtZip
    if ($summary.files.hook.sha256 -ne $ExpectedHookSha256.Trim().ToLowerInvariant()) {
        throw "Hook candidate SHA-256 mismatch"
    }
    if ($summary.files.loomDaemon.sha256 -ne $ExpectedLoomDaemonSha256.Trim().ToLowerInvariant()) {
        throw "Loom daemon candidate SHA-256 mismatch"
    }
    $listenerCount = @(
        $summary.preflight.selectedPortListeners.store,
        $summary.preflight.selectedPortListeners.daemon,
        $summary.preflight.selectedPortListeners.bridge
    ) | ForEach-Object { @($_).Count } | Measure-Object -Sum | Select-Object -ExpandProperty Sum
    if ($listenerCount -ne 0) {
        throw "one or more selected isolated ports already has a listener"
    }
    $summary.preflight.ready = $ValidateLoomServicesOnly.IsPresent -or ($hookProcessesBefore.Count -eq 0)
    if ($PreflightOnly) {
        $summary.status = if ($summary.preflight.ready) { "preflight_ready" } else { "blocked_existing_hook" }
        $summary.finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
        Write-Summary -Summary $summary
        Write-Host "[hook-loom-surface-candidate] $($summary.status): $summaryPath"
        return
    }
    if (-not $ValidateLoomServicesOnly -and $hookProcessesBefore.Count -ne 0) {
        throw "Refusing to start the dual-end candidate while another Hook main/watchdog process exists"
    }

    New-Item -ItemType Directory -Path `
        $storeRoot, `
        (Join-Path $storeRoot "frameworks"), `
        (Join-Path $storeRoot "arts"), `
        $controlPlaneRoot, `
        $appDataRoot, `
        $localAppDataRoot, `
        $manifestDir, `
        $logsRoot, `
        $innerArtifactRoot `
        -Force | Out-Null
    Copy-Item -LiteralPath $processFrameworkZip -Destination (Join-Path $storeRoot "frameworks\process.zip") -Force
    $dashboardVersionRoot = Join-Path $storeRoot "arts\surface-device-dashboard"
    New-Item -ItemType Directory -Path $dashboardVersionRoot -Force | Out-Null
    $dashboardVersionZip = Join-Path $dashboardVersionRoot "1.0.0.zip"
    Copy-Item -LiteralPath $dashboardArtZip -Destination $dashboardVersionZip -Force
    $dashboardDigest = (Get-FileHash -LiteralPath $dashboardVersionZip -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$dashboardVersionZip.sha256", "$dashboardDigest  1.0.0.zip`n", [Text.UTF8Encoding]::new($false))

    $summary.status = "starting_isolated_loom"
    Write-Summary -Summary $summary
    $storeProcess = Start-InheritedEnvironmentProcess -FilePath $artStoreExe -WorkingDirectory $loomRepoRoot -Environment @{
        LOOM_ART_STORE_HOST = "127.0.0.1"
        LOOM_ART_STORE_PORT = "$storePort"
        LOOM_ART_STORE_ROOT = $storeRoot
    } -StdoutPath (Join-Path $logsRoot "art-store.stdout.log") -StderrPath (Join-Path $logsRoot "art-store.stderr.log")
    [void](Wait-Http -Uri "$storeBaseUrl/health" -Process $storeProcess -TimeoutSeconds $StartupTimeoutSeconds)

    $daemonProcess = Start-InheritedEnvironmentProcess -FilePath $loomDaemonExe -WorkingDirectory $resolvedLoomPackageDir -Environment @{
        LOOM_DAEMON_HOST = "127.0.0.1"
        LOOM_DAEMON_PORT = "$daemonPort"
        LOOM_DAEMON_TOKEN = ""
        LOOM_CONTROL_PLANE_ROOT = $controlPlaneRoot
        LOOM_ART_STORE_URL = $storeBaseUrl
        LOOM_CAPABILITY_MANIFEST_DIR = $manifestDir
        APPDATA = $appDataRoot
        LOCALAPPDATA = $localAppDataRoot
    } -StdoutPath (Join-Path $logsRoot "loom-daemon.stdout.log") -StderrPath (Join-Path $logsRoot "loom-daemon.stderr.log")
    [void](Wait-Http -Uri "$daemonBaseUrl/health" -Process $daemonProcess -TimeoutSeconds $StartupTimeoutSeconds)
    $servicesStarted = $true
    $summary.serviceProcesses = [ordered]@{
        artStorePid = $storeProcess.Id
        daemonPid = $daemonProcess.Id
        artStorePath = $artStoreExe
        daemonPath = $loomDaemonExe
    }

    $frameworkInstall = Invoke-JsonPost -Uri "$daemonBaseUrl/v1/frameworks/process/install" -Body @{}
    if ($frameworkInstall.framework.id -ne "process" -or $frameworkInstall.framework.ready -ne $true) {
        throw "isolated Loom process framework install failed"
    }
    $artInstall = Invoke-JsonPost -Uri "$daemonBaseUrl/v1/arts/store/install" -Body @{ artId = "surface-device-dashboard" }
    $bridge = Invoke-JsonPost -Uri "$daemonBaseUrl/v1/hook-bridge/start" -Body @{ port = $bridgePort }
    if ($bridge.running -ne $true -or [int]$bridge.port -ne $bridgePort) {
        throw "isolated Loom Hook bridge did not start on the selected port"
    }
    $manifestPath = Join-Path $manifestDir "loom.json"
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 200
    }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "isolated packaged Loom daemon did not write loom.json"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$manifest.transport.baseUrl -ne $daemonBaseUrl) {
        throw "isolated Loom manifest base URL mismatch"
    }
    $summary.install = [ordered]@{
        framework = $frameworkInstall
        art = $artInstall
        bridge = $bridge
        manifestPath = $manifestPath
        manifestBaseUrl = [string]$manifest.transport.baseUrl
    }

    if ($ValidateLoomServicesOnly) {
        $summary.status = "validated_pending_cleanup"
        Write-Summary -Summary $summary
    }
    else {
        $summary.status = "running_hook_native_dual_end"
        Write-Summary -Summary $summary
        $innerArgs = @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $innerScript,
            "-HookExe", $resolvedHookExe,
            "-DurationSeconds", [string]$DurationSeconds,
            "-WarmupSeconds", [string]$WarmupSeconds,
            "-SampleIntervalMs", [string]$SampleIntervalMs,
            "-MaxPrivateGrowthMb", [string]$MaxPrivateGrowthMb,
            "-MaxPrivateGrowthPercent", [string]$MaxPrivateGrowthPercent,
            "-StartupTimeoutSeconds", [string]$StartupTimeoutSeconds,
            "-ArtifactRoot", $innerArtifactRoot,
            "-RequireSurfaceDashboard",
            "-LoomManifestPath", $manifestPath,
            "-LoomHookWsUrl", $bridgeWsUrl,
            "-SurfaceBaseUrl", $daemonBaseUrl
        )
        $innerArgs += @("-ExpectedSha256", $ExpectedHookSha256)
        & powershell.exe @innerArgs
        $innerExitCode = $LASTEXITCODE
        if (-not (Test-Path -LiteralPath $innerSummaryPath -PathType Leaf)) {
            throw "inner Hook native acceptance did not write its summary; exitCode=$innerExitCode"
        }
        $summary.innerSummary = Get-Content -LiteralPath $innerSummaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($innerExitCode -ne 0 -or $summary.innerSummary.passed -ne $true) {
            throw "inner Hook native dual-end acceptance failed; exitCode=$innerExitCode"
        }

        $summary.status = "validated_pending_cleanup"
        Write-Summary -Summary $summary
    }
}
catch {
    $summary.status = "failed"
    $summary.error = $_.Exception.Message
}
finally {
    $bridgeStop = $null
    if ($servicesStarted) {
        try {
            $bridgeStop = Invoke-JsonPost -Uri "$daemonBaseUrl/v1/hook-bridge/stop" -Body @{}
        }
        catch {
            $bridgeStop = @{ error = $_.Exception.Message }
        }
    }
    $daemonStopped = Stop-OwnedProcess -Process $daemonProcess
    $daemonProcess = $null
    $storeStopped = Stop-OwnedProcess -Process $storeProcess
    $storeProcess = $null
    Start-Sleep -Milliseconds 500
    $listenersAfter = [ordered]@{
        store = @(Get-PortListenerProcessIds -Port $storePort)
        daemon = @(Get-PortListenerProcessIds -Port $daemonPort)
        bridge = @(Get-PortListenerProcessIds -Port $bridgePort)
    }
    $cleanupPassed = $daemonStopped -and $storeStopped -and
        @($listenersAfter.store).Count -eq 0 -and
        @($listenersAfter.daemon).Count -eq 0 -and
        @($listenersAfter.bridge).Count -eq 0
    $summary.cleanup = [ordered]@{
        bridgeStop = $bridgeStop
        daemonStopped = $daemonStopped
        artStoreStopped = $storeStopped
        listenersAfter = $listenersAfter
        passed = $cleanupPassed
    }
    if ($summary.status -eq "validated_pending_cleanup" -and $cleanupPassed) {
        $summary.status = "passed"
        $summary.passed = $true
    }
    elseif ($summary.status -eq "validated_pending_cleanup") {
        $summary.status = "failed"
        $summary.error = "isolated Loom cleanup failed"
    }
    $summary.finishedAt = [DateTimeOffset]::UtcNow.ToString("o")
    Write-Summary -Summary $summary
}

if ($summary.status -eq "failed") {
    throw "Hook/Loom Surface candidate acceptance failed: $($summary.error); summary=$summaryPath"
}
if (-not $PreflightOnly) {
    Write-Host "[hook-loom-surface-candidate] Passed: $summaryPath"
}
