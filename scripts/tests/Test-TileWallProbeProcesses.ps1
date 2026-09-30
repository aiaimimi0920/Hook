Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tile-wall/ownedProcesses.ps1')
$start = [datetime]'2026-09-12T00:00:00Z'
$rows = @(
    @{ ProcessId = 10; ParentProcessId = 1; CreationDate = $start },
    @{ ProcessId = 20; ParentProcessId = 10; CreationDate = $start.AddSeconds(1) },
    @{ ProcessId = 30; ParentProcessId = 20; CreationDate = $start.AddSeconds(2) },
    @{ ProcessId = 40; ParentProcessId = 20; CreationDate = $start.AddDays(-1) },
    @{ ProcessId = 50; ParentProcessId = 40; CreationDate = $start.AddDays(-1).AddSeconds(1) },
    @{ ProcessId = 60; ParentProcessId = 10; CreationDate = $null }
)
$owned = @(Get-TileWallOwnedProcessTree -Processes $rows -ActiveOwnedRootIds @(10))
if (($owned.ProcessId | Sort-Object) -join ',' -cne '10,20,30') { throw 'PID reuse or unknown creation time escaped ownership boundary' }
$none = @(Get-TileWallOwnedProcessTree -Processes $rows -ActiveOwnedRootIds @())
if ($none.Count -ne 0) { throw 'An inactive root was used to claim process descendants' }
$known = @(@{ pid = 20; startedUtc = $start.AddSeconds(1).ToUniversalTime().ToString('o') })
$orphans = @($rows | Where-Object ProcessId -NE 10)
$retained = @(Get-TileWallOwnedProcessTree -Processes $orphans -ActiveOwnedRootIds @() -KnownIdentities $known)
if (($retained.ProcessId | Sort-Object) -join ',' -cne '20,30') { throw 'Known live descendants were lost after their root exited' }
$recycled = @($orphans | ForEach-Object {
    $copy = $_.Clone()
    if ($copy.ProcessId -eq 20) { $copy.CreationDate = $start.AddSeconds(60) }
    $copy
})
$rejected = @(Get-TileWallOwnedProcessTree -Processes $recycled -ActiveOwnedRootIds @() -KnownIdentities $known)
if ($rejected.Count) { throw 'A retained identity claimed a recycled PID' }
$script:sampleProcess = [pscustomobject]@{
    Id = 10; ProcessName = 'owned'; StartTime = $start; HasExited = $false
    TotalProcessorTime = $null; PrivateMemorySize64 = 100; WorkingSet64 = 200; HandleCount = 3
    Disposed = $false
}
$script:sampleProcess | Add-Member ScriptMethod Dispose { $this.Disposed = $true }
function Get-Process {
    [CmdletBinding()]
    param([int]$Id)
    return $script:sampleProcess
}
$info = @{ ProcessId = 10; CreationDate = $start; ExecutablePath = 'owned.exe' }
if ($null -ne (Get-TileWallProcessSample -Info $info)) { throw 'An unavailable CPU measurement must be skipped' }
if (-not $script:sampleProcess.Disposed) { throw 'A sampled process handle must be disposed' }
$script:sampleProcess.TotalProcessorTime = [timespan]::FromMilliseconds(125)
$script:sampleProcess.StartTime = $start.AddTicks(7)
$sample = Get-TileWallProcessSample -Info $info
if ($sample.cpuMs -ne 125 -or $sample.pid -ne 10) { throw 'A live process sample was lost to CIM timestamp precision' }
$script:sampleProcess.StartTime = $start.AddSeconds(1)
if ($null -ne (Get-TileWallProcessSample -Info $info)) { throw 'A reused PID must not be measured as the old process' }
$script:sampleProcess.StartTime = $start
$script:sampleProcess.HasExited = $true
if ($null -ne (Get-TileWallProcessSample -Info $info)) { throw 'An exited process must not produce a sample' }
$script:sampleProcess.HasExited = $false
$script:sampleProcess | Add-Member ScriptProperty TotalProcessorTime { throw 'process exited during measurement' } -Force
if ($null -ne (Get-TileWallProcessSample -Info $info)) { throw 'An exit race must not abort the probe' }
Write-Output 'Tile wall process contract passed: ownership, PID reuse, timestamp precision, unavailable CPU, exit races and handle disposal'
