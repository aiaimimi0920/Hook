# Owns checked command execution, Tea startup/retry, readiness waits, and authenticated text reads.

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

function Start-TeaDaemonWithPortRetry {
    param(
        [string]$TeaExe,
        [string]$TeaRoot,
        [int]$InitialPort,
        [bool]$AutoPort,
        [string]$StdoutPath,
        [string]$StderrPath,
        [int]$TimeoutSec,
        $Summary,
        [string]$SummaryPath
    )

    $maxAttempts = if ($AutoPort) { 5 } else { 1 }
    $port = $InitialPort

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        if ($AutoPort -and $attempt -gt 1) {
            $port = Get-FreeTcpPort
        }

        $baseUrlForAttempt = "http://127.0.0.1:$port"
        $env:TEA_BIND_ADDR = "127.0.0.1:$port"
        $Summary["base_url"] = $baseUrlForAttempt
        $Summary["tea_port"] = $port
        $Summary["tea_bind_attempts"] = $attempt

        Write-Host ">> starting tea-daemon at $baseUrlForAttempt (attempt $attempt/$maxAttempts)"
        $process = Start-Process -FilePath $TeaExe `
            -WorkingDirectory $TeaRoot `
            -RedirectStandardOutput $StdoutPath `
            -RedirectStandardError $StderrPath `
            -WindowStyle Hidden `
            -PassThru
        $Summary["daemon_pid"] = $process.Id
        Write-SmokeSummary -Summary $Summary -Path $SummaryPath

        try {
            Wait-TeaHealth -BaseUrl $baseUrlForAttempt -Process $process -TimeoutSec $TimeoutSec
            return [pscustomobject]@{
                process = $process
                port = $port
                base_url = $baseUrlForAttempt
                attempts = $attempt
            }
        }
        catch {
            $bindFailed = Test-TeaDaemonBindFailure -StderrPath $StderrPath
            if ($process -ne $null) {
                if (!$process.HasExited) {
                    [void](Stop-SmokeProcess -ProcessId $process.Id -Name "tea-daemon failed bind attempt" -TimeoutMs 5000)
                }
                $process.Dispose()
            }

            if ($AutoPort -and $bindFailed -and $attempt -lt $maxAttempts) {
                Write-Host ">> tea-daemon bind failed on auto port $port; retrying with a new port"
                continue
            }

            throw
        }
    }

    throw "tea-daemon did not bind after $maxAttempts attempts"
}

function Wait-HttpOk {
    param(
        [string]$Url,
        [System.Diagnostics.Process]$Process,
        [string]$Name,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) {
            $Process.Refresh()
            throw "$Name exited early with code $($Process.ExitCode)"
        }

        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -Method Get -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 300
        }
    }

    throw "$Name did not become ready at $Url within $TimeoutSec seconds"
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
