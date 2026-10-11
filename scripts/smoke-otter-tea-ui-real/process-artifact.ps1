# Owns port/process discovery, bounded log tails, artifacts, summaries, and process cleanup.

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

        $listenerPid = 0
        [void][int]::TryParse($parts[$parts.Count - 1], [ref]$listenerPid)
        $listeners += [pscustomobject]@{
            local_endpoint = $localEndpoint
            local_address = $localEndpoint.Substring(0, $lastColon)
            local_port = $localPort
            pid = $listenerPid
        }
    }

    return $listeners
}

function Get-LogTail {
    param(
        [string]$Path,
        [int]$Tail = 60
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

function Test-TeaDaemonBindFailure {
    param(
        [string]$StderrPath
    )

    $stderrText = (@(Get-LogTail -Path $StderrPath -Tail 20) -join "`n")
    return (
        $stderrText -match "os error 10013" -or
        $stderrText -match "access permissions.*socket" -or
        $stderrText -match "Only one usage of each socket address" -or
        $stderrText -match "Address already in use" -or
        $stderrText -match "以一种访问权限不允许的方式"
    )
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

function Write-SmokeSummary {
    param(
        $Summary,
        [string]$Path
    )

    $Summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
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

function Stop-SmokeProcess {
    param(
        [int]$ProcessId,
        [string]$Name,
        [int]$TimeoutMs = 5000
    )

    if ($ProcessId -le 0) {
        return $true
    }

    if ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        return $true
    }

    Write-Host ">> stopping $Name pid=$ProcessId"
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    do {
        if ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
            return $true
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)

    return ($null -eq (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
}

