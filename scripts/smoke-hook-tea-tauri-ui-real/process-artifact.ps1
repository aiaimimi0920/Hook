# Owns port/process inspection, bounded logs, artifact containment, and summary persistence.

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
    $listener.Start()
    try {
        return $listener.LocalEndpoint.Port
    }
    finally {
        $listener.Stop()
    }
}

function ConvertTo-IsoTime {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }
    try {
        if ($Value -is [datetime]) {
            return $Value.ToString("o")
        }
        return ([System.Management.ManagementDateTimeConverter]::ToDateTime([string]$Value)).ToString("o")
    }
    catch {
        return [string]$Value
    }
}

function Get-ProcessInfo {
    param(
        [int]$TargetProcessId
    )

    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $TargetProcessId" -ErrorAction SilentlyContinue
    if ($null -eq $proc) {
        return $null
    }

    return [pscustomobject]@{
        processId = [int]$proc.ProcessId
        parentProcessId = [int]$proc.ParentProcessId
        name = $proc.Name
        executablePath = $proc.ExecutablePath
        commandLine = $proc.CommandLine
        creationDate = ConvertTo-IsoTime $proc.CreationDate
    }
}

function Get-PortListeners {
    param(
        [int]$Port
    )

    $listeners = @()
    $lines = @(netstat -ano -p TCP 2>$null)
    foreach ($line in $lines) {
        $parts = @($line -split "\s+" | Where-Object { $_ -ne "" })
        if ($parts.Count -lt 5 -or $parts[0] -ne "TCP") {
            continue
        }

        $state = $parts[$parts.Count - 2]
        if ($state -ne "LISTENING") {
            continue
        }

        $localEndpoint = $parts[1]
        $lastColon = $localEndpoint.LastIndexOf(":")
        if ($lastColon -lt 0) {
            continue
        }

        $localPortText = $localEndpoint.Substring($lastColon + 1)
        $localPort = 0
        if (![int]::TryParse($localPortText, [ref]$localPort)) {
            continue
        }
        if ($localPort -ne $Port) {
            continue
        }

        $listenerProcessId = 0
        [void][int]::TryParse($parts[$parts.Count - 1], [ref]$listenerProcessId)
        $listeners += [pscustomobject]@{
            local_endpoint = $localEndpoint
            local_address = $localEndpoint.Substring(0, $lastColon)
            local_port = $localPort
            pid = $listenerProcessId
            process = Get-ProcessInfo -TargetProcessId $listenerProcessId
        }
    }

    return $listeners
}

function Assert-NoPreexistingPortListeners {
    param(
        $Summary,
        [string]$SummaryPath,
        [object[]]$TeaListeners,
        [object[]]$HookListeners,
        [object[]]$DebugListeners
    )

    $preexistingCount = $TeaListeners.Count + $HookListeners.Count + $DebugListeners.Count
    $Summary["preexisting_tea_listeners"] = @($TeaListeners)
    $Summary["preexisting_hook_listeners"] = @($HookListeners)
    $Summary["preexisting_debug_listeners"] = @($DebugListeners)
    $Summary["preexisting_listener_count"] = $preexistingCount

    if ($preexistingCount -gt 0) {
        $Summary["status"] = "blocked_preexisting_listener"
        $Summary["error"] = "Refusing to run Hook Tea Tauri UI smoke because selected Tea, Hook, or CDP ports already have listeners"
        $Summary["finished_at"] = (Get-Date).ToString("o")
        Write-SmokeSummary -Summary $Summary -Path $SummaryPath
        throw $Summary["error"]
    }
}

function Get-LogTail {
    param(
        [string]$Path,
        [int]$Tail = 80
    )

    if (!(Test-Path -LiteralPath $Path)) {
        return @()
    }

    $stream = $null
    $reader = $null
    $lines = [System.Collections.Generic.List[string]]::new()

    try {
        $stream = [System.IO.FileStream]::new(
            $Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
        $reader = [System.IO.StreamReader]::new($stream)
        while (!$reader.EndOfStream) {
            $lines.Add($reader.ReadLine())
            if ($lines.Count -gt $Tail) {
                $lines.RemoveAt(0)
            }
        }
    }
    catch {
        $lines.Add("failed to read log tail: $($_.Exception.Message)")
    }
    finally {
        if ($reader -ne $null) {
            $reader.Dispose()
        }
        elseif ($stream -ne $null) {
            $stream.Dispose()
        }
    }

    return @($lines.ToArray())
}

function Get-StoreFiles {
    param(
        [string]$StorePath
    )

    $paths = @(
        $StorePath,
        "$StorePath-shm",
        "$StorePath-wal"
    )
    $files = @()
    foreach ($path in $paths) {
        if (!(Test-Path -LiteralPath $path)) {
            continue
        }

        $item = Get-Item -LiteralPath $path
        $files += [pscustomobject]@{
            name = $item.Name
            path = $item.FullName
            length = $item.Length
        }
    }

    return $files
}

function Remove-SmokeDirectoryInsideArtifact {
    param(
        [string]$Path,
        [string]$ArtifactRoot
    )

    if (!(Test-Path -LiteralPath $Path)) {
        return $false
    }

    $trimSeparators = @(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $resolvedPath = (Resolve-Path -LiteralPath $Path).Path.TrimEnd($trimSeparators)
    $resolvedRoot = (Resolve-Path -LiteralPath $ArtifactRoot).Path.TrimEnd($trimSeparators)
    $resolvedRootWithSeparator = "$resolvedRoot$([System.IO.Path]::DirectorySeparatorChar)"
    $isArtifactRoot = [System.String]::Equals($resolvedPath, $resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)
    $isInsideArtifactRoot = $resolvedPath.StartsWith($resolvedRootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)
    if (!$isArtifactRoot -and !$isInsideArtifactRoot) {
        throw "Refusing recursive cleanup outside artifact root: path=$resolvedPath root=$resolvedRoot"
    }

    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
    return $true
}

function Write-SmokeSummary {
    param(
        $Summary,
        [string]$Path
    )

    $Summary | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Set-SmokeCleanupPhase {
    param(
        $Summary,
        [string]$Path,
        [string]$Phase,
        [string]$Detail = $Phase
    )

    $Summary["cleanup_phase"] = $Phase
    $Summary["cleanup_detail"] = $Detail
    Write-SmokeSummary -Summary $Summary -Path $Path
}

