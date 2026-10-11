# Owns process stopping, checked commands, Tea/CDP readiness, and authenticated text reads.

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

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory
    )

    Write-Host ">> $FilePath $($Arguments -join ' ')"
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }

    if ($exitCode -ne 0) {
        throw "Command failed with exit code $exitCode`: $FilePath $($Arguments -join ' ')"
    }
}

function Wait-TeaHealth {
    param(
        [string]$BaseUrl,
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            $Process.Refresh()
            throw "tea-daemon exited early with code $($Process.ExitCode)"
        }

        try {
            $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -TimeoutSec 2
            if ($health.status -eq "ok") {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 300
        }
    }

    throw "tea-daemon did not become healthy at $BaseUrl within $TimeoutSec seconds"
}

function Wait-CdpAvailable {
    param(
        [int]$Port,
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            $Process.Refresh()
            throw "Tauri dev command exited early with code $($Process.ExitCode)"
        }

        try {
            $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -Method Get -TimeoutSec 2
            if ($version.Browser) {
                return $version
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "WebView2 CDP endpoint did not become ready on port $Port within $TimeoutSec seconds"
}

function Invoke-TeaText {
    param(
        [string]$Uri,
        [string]$AuthToken
    )

    $request = [System.Net.WebRequest]::Create($Uri)
    $request.Method = "GET"
    $request.Headers["Authorization"] = "Bearer $AuthToken"
    $response = $null
    $reader = $null
    try {
        $response = $request.GetResponse()
        $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
        return $reader.ReadToEnd()
    }
    finally {
        if ($reader -ne $null) {
            $reader.Dispose()
        }
        if ($response -ne $null) {
            $response.Dispose()
        }
    }
}

