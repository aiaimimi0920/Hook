function Get-TileWallOwnedProcessTree {
    param([object[]]$Processes, [int[]]$ActiveOwnedRootIds, [object[]]$KnownIdentities = @())
    $byId = @{}
    foreach ($row in $Processes) { $byId[[int]$row.ProcessId] = $row }
    $ids = New-Object 'System.Collections.Generic.HashSet[int]'
    foreach ($id in $ActiveOwnedRootIds) {
        if ($byId.ContainsKey($id) -and $byId[$id].CreationDate) { $null = $ids.Add($id) }
    }
    # Descendants can outlive a root; only retain the exact observed process.
    foreach ($identity in $KnownIdentities) {
        $id = [int]$identity.pid
        if ($byId.ContainsKey($id) -and $byId[$id].CreationDate -and
            $byId[$id].CreationDate.ToUniversalTime().ToString('o') -ceq $identity.startedUtc) {
            $null = $ids.Add($id)
        }
    }
    do {
        $changed = $false
        foreach ($row in $Processes) {
            $parentId = [int]$row.ParentProcessId
            # Windows keeps the numeric parent PID after exit. A reused PID cannot
            # make a process created before that new parent part of this probe.
            if ($ids.Contains($parentId) -and $row.CreationDate -and
                $row.CreationDate -ge $byId[$parentId].CreationDate -and $ids.Add([int]$row.ProcessId)) {
                $changed = $true
            }
        }
    } while ($changed)
    @($Processes | Where-Object { $ids.Contains([int]$_.ProcessId) })
}

function Get-TileWallProcessSample {
    param([object]$Info)
    $process = $null
    try {
        if (-not $Info.CreationDate) { return $null }
        $process = Get-Process -Id $Info.ProcessId -ErrorAction Stop
        $started = $process.StartTime.ToUniversalTime()
        $expected = $Info.CreationDate.ToUniversalTime()
        # CIM truncates creation time to microseconds. Keep integer precision and
        # reject PID reuse between the tree snapshot and opening this handle.
        if (($started.Ticks - $started.Ticks % 10) -ne ($expected.Ticks - $expected.Ticks % 10)) { return $null }
        $cpu = $process.TotalProcessorTime
        if ($cpu -isnot [timespan] -or $process.HasExited) { return $null }
        $sample = @{ pid = $process.Id; name = $process.ProcessName; path = $Info.ExecutablePath
            startedUtc = $expected.ToString('o'); privateBytes = $process.PrivateMemorySize64
            workingSetBytes = $process.WorkingSet64; handles = $process.HandleCount; cpuMs = $cpu.TotalMilliseconds }
        if (-not $process.HasExited) { return $sample }
    } catch {
        # Short-lived Art children can exit between any two native property reads.
        return $null
    } finally {
        if ($process) { $process.Dispose() }
    }
}
