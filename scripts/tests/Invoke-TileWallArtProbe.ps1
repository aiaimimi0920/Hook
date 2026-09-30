[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$HookExe,
    [Parameter(Mandatory = $true)][string]$LoomPackageDir,
    [Parameter(Mandatory = $true)][string]$PrototypeDir,
    [Parameter(Mandatory = $true)][string]$EvidenceRoot,
    [string]$OutputId = '',
    [ValidateSet('art', 'presentation')][string]$Scenario = 'art'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$root = [IO.Path]::GetFullPath($EvidenceRoot)
$artifacts = [IO.Path]::GetFullPath((Join-Path $repo 'artifacts')).TrimEnd('\') + '\'
if (-not $root.StartsWith($artifacts, [StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence must stay below Hook/artifacts' }
if (Test-Path -LiteralPath $root) { throw 'Evidence directory already exists' }
$HookExe = (Resolve-Path -LiteralPath $HookExe).Path
$PrototypeDir = (Resolve-Path -LiteralPath $PrototypeDir).Path
$daemonExe = (Resolve-Path -LiteralPath (Join-Path $LoomPackageDir 'runtime/loom-daemon.exe')).Path
$provenance = Get-Content -LiteralPath (Join-Path (Split-Path $HookExe) 'build-provenance.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$hookHash = (Get-FileHash -LiteralPath $HookExe -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hookHash -cne $provenance.artifact.sha256.ToLowerInvariant()) { throw 'Hook candidate digest mismatch' }
$owned = New-Object 'System.Collections.Generic.List[System.Diagnostics.Process]'
$processPaths = New-Object 'System.Collections.Generic.List[object]'
$samples = New-Object 'System.Collections.Generic.List[object]'
$tracked = @{}
$utf8 = New-Object Text.UTF8Encoding($false)
. (Join-Path $PSScriptRoot 'tile-wall/ownedProcesses.ps1')
function Write-Json([string]$Name, $Value) {
    [IO.File]::WriteAllText((Join-Path $root $Name), (ConvertTo-Json -InputObject $Value -Depth 40), $utf8)
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
function Wait-File([string]$Name, [Diagnostics.Process]$Process, [datetime]$After = [datetime]::MinValue) {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not (Test-Path -LiteralPath (Join-Path $root $Name)) -or (Get-Item -LiteralPath (Join-Path $root $Name)).LastWriteTimeUtc -le $After) {
        $Process.Refresh()
        if ($Process.HasExited -or [DateTime]::UtcNow -ge $deadline) { throw "Process did not produce $Name; inspect isolated logs" }
        Start-Sleep -Milliseconds 100
    }
}
function Run-Node([string]$Script, [string]$Name, [string]$Extra = '', [int]$TimeoutSeconds = 240) {
    $arguments = @('--experimental-strip-types', ('"' + (Join-Path $PSScriptRoot "tile-wall/$Script") + '"'), ('"' + $root + '"'))
    if ($Extra) { $arguments += '"' + $Extra + '"' }
    $process = Start-Owned (Get-Command node.exe).Source $arguments @{} $Name
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while (-not $process.WaitForExit(1000)) {
        if ($samples.Count -ge 1200) { throw 'Process sample budget exhausted' }
        $samples.Add(@{ phase = $Name; atUtc = [DateTime]::UtcNow.ToString('o'); processes = @(Owned-Sample) })
        if ([DateTime]::UtcNow -ge $deadline) { throw "$Name exceeded its $TimeoutSeconds-second limit" }
    }
    $process.WaitForExit(); $process.Refresh()
    if ($process.ExitCode -ne 0) { throw "$Name failed; inspect $Name.stderr.log" }
}
function Owned-Sample {
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CreationDate, ExecutablePath)
    $activeIds = @($owned | ForEach-Object { $_.Refresh(); if (-not $_.HasExited) { $_.Id } })
    @(Get-TileWallOwnedProcessTree -Processes $all -ActiveOwnedRootIds $activeIds | ForEach-Object {
        # Cleanup ownership must survive an unavailable resource measurement.
        $identity = @{ pid = [int]$_.ProcessId; startedUtc = $_.CreationDate.ToUniversalTime().ToString('o') }
        $tracked["$($identity.pid):$($identity.startedUtc)"] = $identity
        $row = Get-TileWallProcessSample -Info $_
        if ($row) { $row }
    })
}
foreach ($name in @('control-plane', 'configuration', 'manifest', 'appdata', 'localappdata', 'hook-data', 'webview', 'output-webview', 'loom-webview')) {
    $null = New-Item -ItemType Directory -Path (Join-Path $root $name) -Force
}
$ports = @()
while ($ports.Count -lt 5) { $port = Free-Port; if ($ports -notcontains $port) { $ports += $port } }
$record = @{ daemonBaseUrl = "http://127.0.0.1:$($ports[0])"; cdpPort = $ports[1]; outputCdpPort = $ports[2]
    daemonExe = $daemonExe; hookExe = $HookExe }
$success = $false
$probe = if ($Scenario -eq 'presentation') { 'probePresentation.ts' } else { 'probeArt.ts' }
try {
    $daemonEnvironment = @{
        LOOM_DAEMON_HOST = '127.0.0.1'; LOOM_DAEMON_PORT = [string]$ports[0]
        LOOM_CONTROL_PLANE_ROOT = (Join-Path $root 'control-plane'); LOOM_CONFIGURATION_ROOT = (Join-Path $root 'configuration')
        LOOM_CAPABILITY_MANIFEST_DIR = (Join-Path $root 'manifest')
        APPDATA = (Join-Path $root 'appdata'); LOCALAPPDATA = (Join-Path $root 'localappdata')
    }
    if ($Scenario -eq 'presentation') {
        $daemonEnvironment.LOOM_HOOK_BRIDGE_PORT = [string]$ports[4]
        $daemonEnvironment.LOOM_HOOK_BRIDGE_URL = "ws://127.0.0.1:$($ports[4])"
    }
    $daemon = Start-Owned $daemonExe @() $daemonEnvironment 'daemon'
    Wait-File 'manifest/loom.json' $daemon
    $record.daemonPid = $daemon.Id
    $environment = @{
        LOOM_MANIFEST_PATH = (Join-Path $root 'manifest/loom.json'); HOOK_APPDATA_DIR = (Join-Path $root 'hook-data')
        APPDATA = (Join-Path $root 'appdata'); LOCALAPPDATA = (Join-Path $root 'localappdata')
        WEBVIEW2_USER_DATA_FOLDER = (Join-Path $root 'webview')
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$($ports[1])"
    }
    $manager = Start-Owned $HookExe @('--tile') $environment 'manager'
    $record.hookPid = $manager.Id; Write-Json 'runtime.json' $record
    Run-Node 'prepareArt.ts' 'prepare' $PrototypeDir
    $record.deviceId = (Get-Content -LiteralPath (Join-Path $root 'runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json).deviceId
    if ($Scenario -eq 'presentation') {
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
    $cli = Start-Owned $HookExe @('--tile-outputs') @{ HOOK_CLI_OUTPUT = (Join-Path $root 'outputs.json') } 'outputs'
    if (-not $cli.WaitForExit(10000)) { throw 'Output enumeration timed out' }
    $parsedOutputs = Get-Content -LiteralPath (Join-Path $root 'outputs.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $outputs = @($parsedOutputs)
    if (-not $OutputId) {
        if ($outputs.Count -ne 1) { throw 'Select an actual physical OutputId on a multi-output host' }
        $OutputId = $outputs[0].outputId
    }
    if (@($outputs | Where-Object outputId -CEQ $OutputId).Count -ne 1) { throw 'Selected output was not enumerated' }
    $environment.WEBVIEW2_USER_DATA_FOLDER = Join-Path $root 'output-webview'
    $environment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$($ports[2])"
    $output = Start-Owned $HookExe @('--tile-output', $OutputId) $environment 'output'
    $record.outputPid = $output.Id; Write-Json 'runtime.json' $record
    $before = @(Owned-Sample)
    Run-Node $probe $Scenario
    if (-not $output.WaitForExit(10000)) { throw 'Output crash phase did not exit its owned process' }
    $restarted = Start-Owned $HookExe @('--tile-output', $OutputId) $environment 'output-restarted'
    $record.outputPid = $restarted.Id; Write-Json 'runtime.json' $record
    Run-Node $probe 'recovery' 'recovery'
    if ($Scenario -eq 'art') { Run-Node 'stressArt.ts' 'stress' '' 420 }
    $manifestTime = (Get-Item -LiteralPath (Join-Path $root 'manifest/loom.json')).LastWriteTimeUtc
    Stop-Process -InputObject $daemon -Force
    if (-not $daemon.WaitForExit(5000)) { throw 'Owned daemon did not stop' }
    Run-Node $probe 'disconnect' 'disconnect'
    $daemon = Start-Owned $daemonExe @() $daemonEnvironment 'daemon-restarted'
    Wait-File 'manifest/loom.json' $daemon $manifestTime
    $record.daemonPid = $daemon.Id; Write-Json 'runtime.json' $record
    Run-Node $probe 'daemon-recovery' 'daemon-recovery'
    $summary = @{
        passed = $true; hookExe = $HookExe; hookSha256 = $hookHash; daemonExe = $daemonExe
        daemonSha256 = (Get-FileHash -LiteralPath $daemonExe -Algorithm SHA256).Hash.ToLowerInvariant()
        scope = 'One physical output; packaged terminal/daemon; real installed PowerShell Art runtimes'
        scenario = $Scenario
        recovery = (Get-Content -LiteralPath (Join-Path $root 'recovery-result.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
        daemonRecovery = (Get-Content -LiteralPath (Join-Path $root 'daemon-recovery-result.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
        resourcesBefore = $before; resourcesAfter = @(Owned-Sample); processPaths = @($processPaths.ToArray())
    }
    $summary[$Scenario] = Get-Content -LiteralPath (Join-Path $root "$Scenario-result.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Scenario -eq 'art') { $summary.stress = Get-Content -LiteralPath (Join-Path $root 'stress-result.json') -Raw -Encoding UTF8 | ConvertFrom-Json }
    Write-Json 'summary.json' $summary
    $success = $true
} catch {
    Write-Json 'failure.json' @{ message = $_.Exception.Message; stack = $_.ScriptStackTrace }
    throw
} finally {
    $null = @(Owned-Sample)
    $cleanup = @($tracked.Values)
    foreach ($process in $owned) {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -InputObject $process -Force -ErrorAction SilentlyContinue }
        $process.WaitForExit(5000) | Out-Null
    }
    $remaining = @()
    foreach ($row in $cleanup) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($row.pid)" -ErrorAction SilentlyContinue
        $process = Get-Process -Id $row.pid -ErrorAction SilentlyContinue
        if ($process -and $current -and $current.CreationDate -and $current.CreationDate.ToUniversalTime().ToString('o') -ceq $row.startedUtc) {
            Stop-Process -InputObject $process -Force -ErrorAction SilentlyContinue
            if (-not $process.WaitForExit(5000)) { $remaining += $row.pid }
        }
    }
    Write-Json 'cleanup.json' @{ passed = $success; ownedPids = @($owned | ForEach-Object Id); remaining = $remaining }
    Write-Json 'process-samples.json' @($samples.ToArray())
    if ($remaining.Count) { throw 'Owned process descendants remain; inspect cleanup.json' }
}
Write-Output (Join-Path $root 'summary.json')
