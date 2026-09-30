param(
    [Parameter(Mandatory)][string]$HookExe,
    [string]$OutputRoot = ""
)
$ErrorActionPreference = "Stop"
$HookExe = (Resolve-Path -LiteralPath $HookExe).Path
if (-not $OutputRoot) {
    $OutputRoot = Join-Path ([IO.Path]::GetTempPath()) ("hook-exit-diagnostics-" + [guid]::NewGuid().ToString("N"))
}
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
if (Test-Path -LiteralPath $OutputRoot) { throw "Evidence directory already exists" }
New-Item -ItemType Directory -Path $OutputRoot | Out-Null
$results = @()
foreach ($status in @(0, 23, -1073741819)) {
    $root = Join-Path $OutputRoot ([string]$status)
    New-Item -ItemType Directory -Path $root | Out-Null
    # Return a status deliberately; this does not cause a real access violation.
    $source = @'
$ErrorActionPreference = 'Stop'
$env:HOOK_LOG_DIR = '__ROOT__'
$child = Start-Process -FilePath '__EXE__' -ArgumentList @('--hook-emergency-watchdog', "$PID") -WindowStyle Hidden -PassThru
[IO.File]::WriteAllText('__ROOT__\watchdog.pid', [string]$child.Id)
$deadline = [DateTime]::UtcNow.AddSeconds(20)
while ([DateTime]::UtcNow -lt $deadline) {
    $log = '__ROOT__\hook-runtime.log'
    if ((Test-Path -LiteralPath $log) -and ([IO.File]::ReadAllText($log) -match 'emergency_watchdog_started')) {
        [Environment]::Exit(__STATUS__)
    }
    if ($child.HasExited) { [Environment]::Exit(99) }
    Start-Sleep -Milliseconds 50
}
[Environment]::Exit(98)
'@
    $source = $source.Replace('__ROOT__', $root.Replace("'", "''")).Replace('__EXE__', $HookExe.Replace("'", "''")).Replace('__STATUS__', [string]$status)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($source))
    $parent = $null
    $watchdog = $null
    try {
        $parent = Start-Process powershell.exe -ArgumentList @("-NoProfile", "-EncodedCommand", $encoded) -WindowStyle Hidden -PassThru
        $pidPath = Join-Path $root "watchdog.pid"
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        while (-not (Test-Path -LiteralPath $pidPath)) {
            if ($parent.HasExited -or [DateTime]::UtcNow -ge $deadline) { throw "Watchdog did not start" }
            Start-Sleep -Milliseconds 25
        }
        $watchdogId = [int][IO.File]::ReadAllText($pidPath)
        $watchdog = Get-Process -Id $watchdogId -ErrorAction SilentlyContinue
        if (-not $parent.WaitForExit(25000)) { throw "Parent timed out" }
        if ($watchdog -and -not $watchdog.WaitForExit(10000)) { throw "Watchdog did not exit with parent" }
        $logText = [IO.File]::ReadAllText((Join-Path $root "hook-runtime.log"))
        $unsigned = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$status), 0)
        $hex = "0x{0:X8}" -f $unsigned
        $expected = "parent_pid=$($parent.Id) exit_code=$unsigned exit_code_hex=$hex"
        if (-not $logText.Contains($expected)) { throw "Missing parent exit evidence: $expected" }
        if ($logText -match 'terminate_parent|parent_exit_query_failed') { throw "Unexpected termination or query failure" }
        $results += [pscustomobject]@{ status = $status; exitCodeHex = $hex; recorded = $true; watchdogExited = $true }
    } finally {
        foreach ($process in @($parent, $watchdog)) {
            if ($process) {
                if (-not $process.HasExited) { $process.Kill(); [void]$process.WaitForExit(5000) }
                $process.Dispose()
            }
        }
    }
}
$result = [pscustomobject]@{ cases = $results; keyboardInputInjected = $false; outputRoot = $OutputRoot }
$json = $result | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $OutputRoot "result.json"), $json, [Text.UTF8Encoding]::new($false))
$json
