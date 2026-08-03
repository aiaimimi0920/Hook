param(
    [string]$HookExe = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($HookExe)) {
    $HookExe = Join-Path $PSScriptRoot "..\src-tauri\target\debug\hook.exe"
}
$HookExe = (Resolve-Path -LiteralPath $HookExe).Path
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$runtimeRoot = [IO.Path]::GetFullPath(
    (Join-Path $tempBase ("hook-watchdog-runtime-" + [guid]::NewGuid().ToString("N")))
)
if (-not $runtimeRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to create the watchdog runtime test outside the temp directory: $runtimeRoot"
}
New-Item -ItemType Directory -Path $runtimeRoot | Out-Null

$parentScript = Join-Path $runtimeRoot "watchdog-parent.ps1"
$parentScriptSource = @'
param(
    [Parameter(Mandatory=$true)][string]$HookPath,
    [Parameter(Mandatory=$true)][string]$InfoPath,
    [Parameter(Mandatory=$true)][string]$LogDir,
    [Parameter(Mandatory=$true)][int]$LifetimeMs
)

$ErrorActionPreference = "Stop"
$env:HOOK_LOG_DIR = $LogDir
$watchdog = Start-Process `
    -FilePath $HookPath `
    -ArgumentList @("--hook-emergency-watchdog", "$PID") `
    -PassThru `
    -WindowStyle Hidden
[IO.File]::WriteAllText(
    $InfoPath,
    "$PID,$($watchdog.Id)",
    [Text.UTF8Encoding]::new($false)
)
Start-Sleep -Milliseconds $LifetimeMs
'@
[IO.File]::WriteAllText(
    $parentScript,
    $parentScriptSource,
    [Text.UTF8Encoding]::new($false)
)

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class HookWatchdogKeyboardTest
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern void keybd_event(
        byte virtualKey,
        byte scanCode,
        uint flags,
        UIntPtr extraInfo
    );

    public const uint KeyEventKeyUp = 0x0002;
}
'@

$testProcesses = New-Object System.Collections.Generic.List[int]

function Start-WatchdogParent {
    param(
        [Parameter(Mandatory=$true)][string]$Name,
        [Parameter(Mandatory=$true)][int]$LifetimeMs
    )

    $caseDirectory = Join-Path $runtimeRoot $Name
    New-Item -ItemType Directory -Path $caseDirectory | Out-Null
    $infoPath = Join-Path $caseDirectory "pids.txt"
    $parent = Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @(
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", $parentScript,
            "-HookPath", $HookExe,
            "-InfoPath", $infoPath,
            "-LogDir", $caseDirectory,
            "-LifetimeMs", "$LifetimeMs"
        ) `
        -PassThru `
        -WindowStyle Hidden
    $testProcesses.Add($parent.Id)

    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not (Test-Path -LiteralPath $infoPath)) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "Timed out waiting for the $Name watchdog process information"
        }
        Start-Sleep -Milliseconds 25
    }

    $parts = ([IO.File]::ReadAllText($infoPath)).Split(",")
    $watchdogPid = [int]$parts[1]
    $testProcesses.Add($watchdogPid)
    return [pscustomobject]@{
        Name = $Name
        Directory = $caseDirectory
        Parent = $parent
        ParentPid = [int]$parts[0]
        WatchdogPid = $watchdogPid
    }
}

function Wait-ProcessGone {
    param(
        [Parameter(Mandatory=$true)][int]$ProcessId,
        [int]$TimeoutMs = 5000
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
        if ([DateTime]::UtcNow -ge $deadline) {
            return $false
        }
        Start-Sleep -Milliseconds 25
    }
    return $true
}

function Send-Key {
    param(
        [Parameter(Mandatory=$true)][byte]$VirtualKey,
        [int]$HoldMs = 40
    )

    [HookWatchdogKeyboardTest]::keybd_event(
        $VirtualKey,
        0,
        0,
        [UIntPtr]::Zero
    )
    Start-Sleep -Milliseconds $HoldMs
    [HookWatchdogKeyboardTest]::keybd_event(
        $VirtualKey,
        0,
        [HookWatchdogKeyboardTest]::KeyEventKeyUp,
        [UIntPtr]::Zero
    )
}

try {
    $mismatchProcess = Start-Process `
        -FilePath $HookExe `
        -ArgumentList @("--hook-emergency-watchdog", "$($PID + 100000)") `
        -PassThru `
        -Wait `
        -WindowStyle Hidden
    if ($mismatchProcess.ExitCode -ne 7) {
        throw "A mismatched watchdog target should exit with code 7; got $($mismatchProcess.ExitCode)"
    }

    $normal = Start-WatchdogParent -Name "normal-exit" -LifetimeMs 250
    if (-not $normal.Parent.WaitForExit(5000)) {
        throw "The normal watchdog parent did not exit"
    }
    if (-not (Wait-ProcessGone -ProcessId $normal.WatchdogPid)) {
        throw "The watchdog remained after its parent exited normally"
    }

    $escape = Start-WatchdogParent -Name "double-escape" -LifetimeMs 600000
    Start-Sleep -Milliseconds 150
    Send-Key -VirtualKey 0x1B
    Start-Sleep -Milliseconds 90
    Send-Key -VirtualKey 0x1B
    if (-not (Wait-ProcessGone -ProcessId $escape.ParentPid)) {
        throw "Double Escape did not terminate the watchdog parent"
    }
    if (-not (Wait-ProcessGone -ProcessId $escape.WatchdogPid)) {
        throw "The watchdog remained after Double Escape"
    }
    $escapeLog = [IO.File]::ReadAllText(
        (Join-Path $escape.Directory "hook-runtime.log")
    )
    if ($escapeLog -notmatch "source=double_escape") {
        throw "The Double Escape termination source was not logged"
    }

    $chord = Start-WatchdogParent -Name "backup-chord" -LifetimeMs 600000
    Start-Sleep -Milliseconds 150
    foreach ($virtualKey in [byte[]](0x11, 0x12, 0x10, 0x7B)) {
        [HookWatchdogKeyboardTest]::keybd_event(
            $virtualKey,
            0,
            0,
            [UIntPtr]::Zero
        )
    }
    Start-Sleep -Milliseconds 80
    foreach ($virtualKey in [byte[]](0x7B, 0x10, 0x12, 0x11)) {
        [HookWatchdogKeyboardTest]::keybd_event(
            $virtualKey,
            0,
            [HookWatchdogKeyboardTest]::KeyEventKeyUp,
            [UIntPtr]::Zero
        )
    }
    if (-not (Wait-ProcessGone -ProcessId $chord.ParentPid)) {
        throw "Ctrl+Alt+Shift+F12 did not terminate the watchdog parent"
    }
    if (-not (Wait-ProcessGone -ProcessId $chord.WatchdogPid)) {
        throw "The watchdog remained after Ctrl+Alt+Shift+F12"
    }
    $chordLog = [IO.File]::ReadAllText(
        (Join-Path $chord.Directory "hook-runtime.log")
    )
    if ($chordLog -notmatch "source=ctrl_alt_shift_f12") {
        throw "The backup chord termination source was not logged"
    }

    [pscustomobject]@{
        mismatchRejected = $true
        normalExitCleanup = $true
        doubleEscape = $true
        backupChord = $true
        residualTestProcesses = @(
            $testProcesses | Where-Object {
                Get-Process -Id $_ -ErrorAction SilentlyContinue
            }
        ).Count
    } | ConvertTo-Json
} finally {
    foreach ($processId in $testProcesses) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    $verifiedRuntimeRoot = [IO.Path]::GetFullPath($runtimeRoot)
    if ($verifiedRuntimeRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $verifiedRuntimeRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
