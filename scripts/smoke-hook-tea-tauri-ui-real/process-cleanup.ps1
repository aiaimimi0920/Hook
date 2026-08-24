# Owns process-tree discovery and bounded cleanup of smoke-owned Hook/WebView listeners.

function Get-ProcessTreeIds {
    param(
        [int[]]$RootIds
    )

    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $childrenByParent = @{}
    foreach ($proc in $all) {
        $parent = [int]$proc.ParentProcessId
        if (-not $childrenByParent.ContainsKey($parent)) {
            $childrenByParent[$parent] = [System.Collections.Generic.List[int]]::new()
        }
        $childrenByParent[$parent].Add([int]$proc.ProcessId)
    }

    $seen = [System.Collections.Generic.HashSet[int]]::new()
    $queue = [System.Collections.Generic.Queue[int]]::new()
    foreach ($rootId in $RootIds) {
        if ($rootId -gt 0 -and $seen.Add($rootId)) {
            $queue.Enqueue($rootId)
        }
    }

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        if ($childrenByParent.ContainsKey($current)) {
            foreach ($child in $childrenByParent[$current]) {
                if ($seen.Add($child)) {
                    $queue.Enqueue($child)
                }
            }
        }
    }

    return @($seen)
}

function Stop-PidSet {
    param(
        [int[]]$ProcessIds,
        [string]$Reason
    )

    $stopped = @()
    foreach ($targetProcessId in @($ProcessIds | Sort-Object -Descending -Unique)) {
        if ($targetProcessId -le 0) {
            continue
        }
        $proc = Get-Process -Id $targetProcessId -ErrorAction SilentlyContinue
        if ($null -eq $proc) {
            continue
        }
        $info = Get-ProcessInfo -TargetProcessId $targetProcessId
        [void](Stop-SmokeProcess -ProcessId $targetProcessId -Name $Reason -TimeoutMs 5000)
        $stopped += [pscustomobject]@{
            processId = $targetProcessId
            reason = $Reason
            process = $info
        }
    }

    return @($stopped)
}

function Get-NewHookProcesses {
    param(
        [string]$HookRoot,
        [datetime]$StartedAfter
    )

    $expectedPrefix = (Join-Path $HookRoot "src-tauri\target\debug").ToLowerInvariant()
    $items = @()
    foreach ($proc in @(Get-Process -Name hook -ErrorAction SilentlyContinue)) {
        $path = $proc.Path
        $start = $null
        try {
            $start = $proc.StartTime
        }
        catch {
            $start = $null
        }
        if ($path -and $path.ToLowerInvariant().StartsWith($expectedPrefix) -and $start -and $start -ge $StartedAfter) {
            $items += [pscustomobject]@{
                processId = [int]$proc.Id
                processName = $proc.ProcessName
                path = $path
                startTime = $start.ToString("o")
            }
        }
    }
    return @($items)
}

function Get-NewWebViewDebugProcesses {
    param(
        [int]$Port,
        [datetime]$StartedAfter
    )

    $items = @()
    foreach ($proc in @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue)) {
        $commandLine = [string]$proc.CommandLine
        if (!$commandLine.Contains("remote-debugging-port=$Port")) {
            continue
        }

        $created = $null
        try {
            $created = [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$proc.CreationDate)
        }
        catch {
            $created = $null
        }
        if ($created -and $created -lt $StartedAfter) {
            continue
        }

        $items += [pscustomobject]@{
            processId = [int]$proc.ProcessId
            processName = $proc.Name
            commandLine = $commandLine
            creationDate = ConvertTo-IsoTime $proc.CreationDate
        }
    }
    return @($items)
}

function Stop-SafeNewPortListeners {
    param(
        [int[]]$Ports,
        [int[]]$BaselinePids,
        [datetime]$StartedAfter,
        [string]$HookRoot,
        [int]$DebugPort
    )

    $stopped = @()
    foreach ($port in $Ports) {
        foreach ($listener in @(Get-PortListeners -Port $port)) {
            $listenerProcessId = [int]$listener.pid
            if ($BaselinePids -contains $listenerProcessId) {
                continue
            }

            $info = $listener.process
            if ($null -eq $info) {
                continue
            }

            $created = $null
            if ($info.creationDate) {
                try {
                    $created = [datetime]::Parse($info.creationDate)
                }
                catch {
                    $created = $null
                }
            }

            $commandLine = [string]$info.commandLine
            $safe =
                ($created -and $created -ge $StartedAfter) -and (
                    $commandLine.Contains("serve-static.mjs") -or
                    $commandLine.Contains("tauri.cmd") -or
                    $commandLine.Contains("hook.exe") -or
                    $commandLine.Contains("remote-debugging-port=$DebugPort") -or
                    ($HookRoot -and $commandLine.Contains($HookRoot))
                )

            if ($safe) {
                $stopped += @(Stop-PidSet -ProcessIds @($listenerProcessId) -Reason "safe new smoke listener on port $port")
            }
        }
    }

    return @($stopped)
}

function Wait-RuntimeLogContains {
    param(
        [string]$RuntimeLogDir,
        [string]$Needle,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $runtimeLog = Get-ChildItem -LiteralPath $RuntimeLogDir -Filter "hook-runtime.log" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($runtimeLog) {
            $tail = @(Get-LogTail -Path $runtimeLog.FullName -Tail 200)
            if (($tail -join "`n").Contains($Needle)) {
                return $runtimeLog.FullName
            }
        }
        Start-Sleep -Milliseconds 300
    }

    throw "Runtime log did not contain '$Needle' within $TimeoutSec seconds"
}
