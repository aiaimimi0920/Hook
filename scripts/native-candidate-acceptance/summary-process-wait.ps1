# Owns summary serialization, process discovery, loopback HTTP, and bounded wait helpers.

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
