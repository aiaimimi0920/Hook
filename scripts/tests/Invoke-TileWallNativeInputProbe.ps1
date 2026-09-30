[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$HookExe,
    [Parameter(Mandatory = $true)][string]$LoomPackageDir,
    [string]$SourceTestExe,
    [Parameter(Mandatory = $true)][string]$EvidenceRoot,
    [switch]$WithManagement,
    [switch]$GuiSource,
    [ValidateRange(0, 600)][int]$SoakSeconds = 0
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($SoakSeconds -gt 0 -and $SoakSeconds -lt 120) { throw 'A resource soak must run for at least 120 seconds' }
if ($SoakSeconds -gt 0) { $WithManagement = $true }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$root = [IO.Path]::GetFullPath($EvidenceRoot)
$artifacts = [IO.Path]::GetFullPath((Join-Path $repo 'artifacts')).TrimEnd('\') + '\'
if (-not $root.StartsWith($artifacts, [StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence must stay below Hook/artifacts' }
if (Test-Path -LiteralPath $root) { throw 'Evidence directory already exists' }
$HookExe = (Resolve-Path -LiteralPath $HookExe).Path
if ($GuiSource) {
    if (Get-Process -Name hook -ErrorAction SilentlyContinue) { throw 'Ordinary GUI source requires no existing Hook process' }
    $WithManagement = $true
} else {
    if (-not $SourceTestExe) { throw 'SourceTestExe is required for the Rust source mode' }
    $SourceTestExe = (Resolve-Path -LiteralPath $SourceTestExe).Path
}
$daemonExe = (Resolve-Path -LiteralPath (Join-Path $LoomPackageDir 'runtime/loom-daemon.exe')).Path
$provenance = Get-Content -LiteralPath (Join-Path (Split-Path $HookExe) 'build-provenance.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$hookHash = (Get-FileHash -LiteralPath $HookExe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hookHash -cne $provenance.artifact.sha256.ToLowerInvariant()) { throw 'Hook candidate digest mismatch' }
$owned = New-Object 'System.Collections.Generic.List[System.Diagnostics.Process]'
$processPaths = New-Object 'System.Collections.Generic.List[object]'
$resourceSamples = New-Object 'System.Collections.Generic.List[object]'
$tracked = @{}
$utf8 = New-Object Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'tile-wall/ownedProcesses.ps1')
function Write-Json([string]$Name, $Value) {
    [IO.File]::WriteAllText((Join-Path $root $Name), ($Value | ConvertTo-Json -Depth 40), $utf8)
}
function Free-Port {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}
function Start-Owned([string]$Exe, [string[]]$Arguments, [hashtable]$Values, [string]$Name) {
    $saved = @{}
    $keys = @(Get-ChildItem Env: | Where-Object Name -Match '^(LOOM_|HOOK_|WEBVIEW2_)' | ForEach-Object Name) + @($Values.Keys)
    try {
        foreach ($key in ($keys | Select-Object -Unique)) {
            $saved[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
            [Environment]::SetEnvironmentVariable($key, $null, 'Process')
        }
        foreach ($key in $Values.Keys) { [Environment]::SetEnvironmentVariable($key, $Values[$key], 'Process') }
        $args = @{ FilePath = $Exe; WorkingDirectory = $repo; WindowStyle = 'Hidden'; PassThru = $true
            RedirectStandardOutput = (Join-Path $root "$Name.stdout.log"); RedirectStandardError = (Join-Path $root "$Name.stderr.log") }
        if ($Arguments.Count) { $args.ArgumentList = $Arguments }
        $process = Start-Process @args
        $null = $process.Handle
        $owned.Add($process)
        $processPaths.Add(@{ role = $Name; pid = $process.Id; requestedExe = $Exe; actualExe = $process.Path })
        return $process
    } finally {
        foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
    }
}
function Wait-File([string]$Name, [Diagnostics.Process]$Process, [int]$Seconds = 30) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while (-not (Test-Path -LiteralPath (Join-Path $root $Name))) {
        $Process.Refresh()
        if ($Process.HasExited -or [DateTime]::UtcNow -ge $deadline) { throw "Process did not produce $Name; inspect its isolated logs" }
        Start-Sleep -Milliseconds 100
    }
}
function Run-Node([string]$Script, [string]$Name, [string]$Phase = '', [int]$TimeoutSeconds = 240) {
    $arguments = @('--experimental-strip-types', ('"' + (Join-Path $PSScriptRoot "tile-wall/$Script") + '"'), ('"' + $root + '"'))
    if ($Phase) { $arguments += $Phase }
    $process = Start-Owned (Get-Command node.exe).Source $arguments @{} $Name
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not $process.WaitForExit(1000)) {
        $sample = Process-Sample
        if ($Name -eq 'soak') {
            if ($resourceSamples.Count -ge 720) { throw 'Resource observation budget exceeded' }
            $resourceSamples.Add($sample)
        }
        if ($tracked.Count -gt 512) { throw 'Owned process identity budget exceeded' }
        if ([DateTime]::UtcNow -ge $deadline) { throw "$Name exceeded its ${TimeoutSeconds}s limit" }
    }
    $process.WaitForExit(); $process.Refresh()
    if ($process.ExitCode -ne 0) { throw "$Name failed; inspect $Name.stderr.log" }
}
function Process-Sample {
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CreationDate, ExecutablePath)
    $activeIds = @($owned | ForEach-Object { $_.Refresh(); if (-not $_.HasExited) { $_.Id } })
    $rows = @(Get-TileWallOwnedProcessTree -Processes $all -ActiveOwnedRootIds $activeIds -KnownIdentities @($tracked.Values) | ForEach-Object {
        $identity = @{ pid = [int]$_.ProcessId; startedUtc = $_.CreationDate.ToUniversalTime().ToString('o') }
        $tracked["$($identity.pid):$($identity.startedUtc)"] = $identity
        $sample = Get-TileWallProcessSample -Info $_
        if ($sample) {
            # A new process can have no Path yet; retain its later identity-checked observation.
            if ($sample.path -and ($activeIds -contains $sample.pid)) {
                $record = $processPaths | Where-Object pid -EQ $sample.pid | Select-Object -Last 1
                if ($record -and -not $record.actualExe) { $record.actualExe = $sample.path }
            }
            $sample
        }
    })
    @{ atUtc = [DateTime]::UtcNow.ToString('o'); processes = $rows }
}
foreach ($name in @('control-plane', 'configuration', 'manifest', 'appdata', 'localappdata', 'hook-data', 'webview', 'output-webview', 'loom-webview')) {
    $null = New-Item -ItemType Directory -Path (Join-Path $root $name) -Force
}
$ports = @()
$portCount = if ($GuiSource) { 6 } elseif ($WithManagement) { 5 } else { 3 }
while ($ports.Count -lt $portCount) { $port = Free-Port; if ($ports -notcontains $port) { $ports += $port } }
$record = @{ daemonBaseUrl = "http://127.0.0.1:$($ports[0])"; cdpPort = $ports[1]; outputCdpPort = $ports[2]
    daemonExe = $daemonExe; hookExe = $HookExe; sourceTestExe = $SourceTestExe; evidenceRoot = $root; soakSeconds = $SoakSeconds }
$sourceProcess = $null
$success = $false
try {
    $daemonEnvironment = @{
        LOOM_DAEMON_HOST = '127.0.0.1'; LOOM_DAEMON_PORT = [string]$ports[0]
        LOOM_CONTROL_PLANE_ROOT = (Join-Path $root 'control-plane'); LOOM_CONFIGURATION_ROOT = (Join-Path $root 'configuration')
        LOOM_CAPABILITY_MANIFEST_DIR = (Join-Path $root 'manifest')
        APPDATA = (Join-Path $root 'appdata'); LOCALAPPDATA = (Join-Path $root 'localappdata')
    }
    if ($WithManagement) {
        $daemonEnvironment.LOOM_HOOK_BRIDGE_PORT = [string]$ports[4]
        $daemonEnvironment.LOOM_HOOK_BRIDGE_URL = "ws://127.0.0.1:$($ports[4])"
    }
    $daemon = Start-Owned $daemonExe @() $daemonEnvironment 'daemon'
    Wait-File 'manifest/loom.json' $daemon
    $record.daemonPid = $daemon.Id
    $terminalEnvironment = @{
        LOOM_MANIFEST_PATH = (Join-Path $root 'manifest/loom.json'); HOOK_APPDATA_DIR = (Join-Path $root 'hook-data')
        APPDATA = (Join-Path $root 'appdata'); LOCALAPPDATA = (Join-Path $root 'localappdata')
        WEBVIEW2_USER_DATA_FOLDER = (Join-Path $root 'webview')
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$($ports[1])"
    }
    $manager = Start-Owned $HookExe @('--tile') $terminalEnvironment 'manager'
    $record.hookPid = $manager.Id
    $fixtureExe = Join-Path $root 'WallInputFixture.exe'
    $csc = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    & $csc /nologo /target:winexe "/out:$fixtureExe" /reference:System.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $PSScriptRoot 'fixtures/LiveScreenshotPhaseZeroFixture.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Native fixture compilation failed' }
    $fixture = Start-Owned $fixtureExe @(('"' + (Join-Path $root 'fixture-ready.json') + '"'), '0', ('"' + (Join-Path $root 'fixture-state.json') + '"')) @{ HOOK_LIVE_FIXTURE_BACKGROUND = '1' } 'fixture'
    Wait-File 'fixture-ready.json' $fixture
    Write-Json 'runtime.json' $record
    Run-Node 'prepareSource.ts' 'prepare' $(if ($GuiSource) { 'gui' } else { '' })
    $record.deviceId = (Get-Content -LiteralPath (Join-Path $root 'runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json).deviceId
    if ($WithManagement) {
        $loomExe = (Resolve-Path -LiteralPath (Join-Path $LoomPackageDir 'Loom.exe')).Path
        $desktopEnvironment = $daemonEnvironment.Clone()
        $desktopEnvironment.LOOM_DAEMON_URL = $record.daemonBaseUrl
        $desktopEnvironment.LOOM_DAEMON_EXECUTABLE = $daemonExe
        $desktopEnvironment.LOOM_SMOKE_ALLOW_MULTIPLE_INSTANCES = '1'
        $desktopEnvironment.LOOM_WEBVIEW2_REMOTE_DEBUGGING_PORT = [string]$ports[3]
        $desktopEnvironment.WEBVIEW2_USER_DATA_FOLDER = Join-Path $root 'loom-webview'
        $desktop = Start-Owned $loomExe @() $desktopEnvironment 'loom-manager'
        $record.loomPid = $desktop.Id; $record.loomCdpPort = $ports[3]; $record.loomExe = $loomExe
    }
    if ($GuiSource) {
        $pointerExe = Join-Path $root 'LiveUnitPointerProbe.exe'
        & $csc /nologo "/out:$pointerExe" (Join-Path $PSScriptRoot 'fixtures/LiveUnitPointerProbe.cs')
        if ($LASTEXITCODE -ne 0) { throw 'Native pointer compilation failed' }
        $sourceEnvironment = $terminalEnvironment.Clone()
        $sourceEnvironment.HOOK_LOG_DIR = Join-Path $root 'source-logs'
        $sourceEnvironment.HOOK_STARTUP_MODE = 'visible'; $sourceEnvironment.HOOK_INITIAL_UI_MODE = 'canvas'
        $sourceEnvironment.HOOK_AUTOSTART_CAPTURE = '0'; $sourceEnvironment.HOOK_ENABLE_LOOM_HOOK = '0'
        $sourceEnvironment.HOOK_NATIVE_ACCEPTANCE = '1'; $sourceEnvironment.HOOK_TEA_INTAKE_ENABLED = '0'
        $sourceEnvironment.HOOK_LIVE_GPU_PREVIEW = '0'
        $sourceEnvironment.LOOM_HOOK_WS_URL = "ws://127.0.0.1:$($ports[4])"
        $sourceEnvironment.WEBVIEW2_USER_DATA_FOLDER = Join-Path $root 'source-webview'
        $sourceEnvironment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$($ports[5])"
        $sourceGui = Start-Owned $HookExe @() $sourceEnvironment 'source-hook'
        $record.sourceHookPid = $sourceGui.Id; $record.sourceCdpPort = $ports[5]; $record.pointerExe = $pointerExe
        Write-Json 'runtime.json' $record
        $sourceProcess = Start-Owned (Get-Command node.exe).Source @('--experimental-strip-types',
            ('"' + (Join-Path $PSScriptRoot 'tile-wall/probeGuiSource.ts') + '"'), ('"' + $root + '"')) @{} 'source'
        Wait-File 'input-source-ready.json' $sourceProcess 120
    } else {
        $sourceProcess = Start-Owned $SourceTestExe @('live_relay_acceptance_tests::wall_input_native_source_endpoint', '--exact', '--ignored', '--nocapture', '--test-threads=1') @{
            HOOK_WALL_INPUT_PROBE_ROOT = $root; HOOK_APPDATA_DIR = (Join-Path $root 'source-data')
        } 'source'
        Wait-File 'input-source-ready.json' $sourceProcess 40
    }
    $cli = Start-Owned $HookExe @('--tile-outputs') @{ HOOK_CLI_OUTPUT = (Join-Path $root 'outputs.json') } 'outputs'
    if (-not $cli.WaitForExit(10000)) { throw 'Output enumeration timed out' }
    $outputs = @(Get-Content -LiteralPath (Join-Path $root 'outputs.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
    if ($outputs.Count -ne 1) { throw 'This probe requires exactly one physical output; select a multi-output acceptance explicitly' }
    $terminalEnvironment.WEBVIEW2_USER_DATA_FOLDER = Join-Path $root 'output-webview'
    $terminalEnvironment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$($ports[2])"
    $output = Start-Owned $HookExe @('--tile-output', $outputs[0].outputId) $terminalEnvironment 'output'
    $record.outputPid = $output.Id; Write-Json 'runtime.json' $record
    $before = Process-Sample
    if ($WithManagement) { Run-Node 'probeManagement.ts' 'management' }
    if ($SoakSeconds -gt 0) {
        Run-Node 'probeLiveSoak.ts' 'soak' '' ($SoakSeconds + 90)
        Write-Json 'resource-samples.json' @{ logicalProcessors = [Environment]::ProcessorCount; samples = @($resourceSamples.ToArray()) }
        Run-Node 'verifySoakResources.ts' 'resource-gate'
    }
    Run-Node 'probeNativeInput.ts' 'input'
    $output.WaitForExit(10000) | Out-Null
    $restarted = Start-Owned $HookExe @('--tile-output', $outputs[0].outputId) $terminalEnvironment 'output-restarted'
    $record.outputPid = $restarted.Id; Write-Json 'runtime.json' $record
    Run-Node 'probeNativeInput.ts' 'recovery' 'recovery'
    if (-not $sourceProcess.WaitForExit(15000)) { throw 'Native source did not finish' }
    $sourceProcess.WaitForExit(); $sourceProcess.Refresh()
    if ($sourceProcess.ExitCode -ne 0) { throw 'Native source semantic or cleanup failure' }
    if ($GuiSource -and -not $sourceGui.WaitForExit(10000)) { throw 'Ordinary Hook source did not exit normally' }
    Write-Json 'summary.json' @{
        passed = $true; hookExe = $HookExe; hookSha256 = $hookHash; daemonExe = $daemonExe
        daemonSha256 = (Get-FileHash -LiteralPath $daemonExe -Algorithm SHA256).Hash.ToLowerInvariant()
        sourceTestExe = $SourceTestExe; sourceTestSha256 = $(if (-not $GuiSource) { (Get-FileHash -LiteralPath $SourceTestExe -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null })
        scope = $(if ($GuiSource) { 'One physical output, packaged terminal, daemon and ordinary Hook GUI source' } else { 'One physical output, packaged terminal and daemon, native WGC/input test harness source' })
        input = (Get-Content -LiteralPath (Join-Path $root 'input-result.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
        recovery = (Get-Content -LiteralPath (Join-Path $root 'recovery-result.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
        management = $(if ($WithManagement) { Get-Content -LiteralPath (Join-Path $root 'management-result.json') -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null })
        soak = $(if ($SoakSeconds -gt 0) { Get-Content -LiteralPath (Join-Path $root 'soak-result.json') -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null })
        resourcesBefore = $before; resourcesAfter = (Process-Sample)
        processPaths = @($processPaths.ToArray())
    }
    $success = $true
} finally {
    if ($resourceSamples.Count) { Write-Json 'resource-samples.json' @{ logicalProcessors = [Environment]::ProcessorCount; samples = @($resourceSamples.ToArray()) } }
    Write-Json 'stop-source' @{ requested = $true }
    if ($sourceProcess -and -not $sourceProcess.HasExited) { $sourceProcess.WaitForExit(15000) | Out-Null }
    Process-Sample | Out-Null
    $cleanup = @($tracked.Values)
    foreach ($process in $owned) {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -InputObject $process -Force -ErrorAction SilentlyContinue }
        $process.WaitForExit(5000) | Out-Null
    }
    # Retain ownership after the root exits, and reject recycled PIDs before cleanup.
    $remaining = @()
    foreach ($row in $cleanup) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($row.pid)" -ErrorAction SilentlyContinue
        $process = Get-Process -Id $row.pid -ErrorAction SilentlyContinue
        if ($process -and $current -and $current.CreationDate -and $current.CreationDate.ToUniversalTime().ToString('o') -ceq $row.startedUtc) {
            Stop-Process -InputObject $process -Force -ErrorAction SilentlyContinue
            if (-not $process.WaitForExit(5000)) { $remaining += $row.pid }
        }
    }
    Write-Json 'cleanup.json' @{ passed = $success; ownedPids = @($owned | ForEach-Object Id)
        trackedIdentities = $cleanup; remaining = $remaining }
    if ($remaining.Count) { throw 'Owned process descendants remain; inspect cleanup.json' }
}
Write-Output (Join-Path $root 'summary.json')
