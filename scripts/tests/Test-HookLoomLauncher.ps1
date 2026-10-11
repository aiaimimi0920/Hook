[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$ArtifactRoot)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\Write-HookLoomLauncher.ps1')
$root = [IO.Path]::GetFullPath($ArtifactRoot)
if (Test-Path -LiteralPath $root) { throw 'Use a fresh test artifact directory.' }
New-Item -ItemType Directory -Path $root | Out-Null
$source = @'
using System;
using System.IO;
using System.Text;
public static class LauncherProbe {
    public static void Main() {
        File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "result.txt"),
            Environment.GetEnvironmentVariable("HOOK_ENABLE_LOOM_HOOK") ?? "unset", new UTF8Encoding(false));
    }
}
'@
$exe = Join-Path $root 'hook.exe'
Add-Type -TypeDefinition $source -OutputAssembly $exe -OutputType ConsoleApplication
$launcher = Write-HookLoomLauncher -HookExe $exe
$bytes = [IO.File]::ReadAllBytes($launcher)
if ($bytes[0] -eq 0xef) { throw 'Launcher must not have a BOM.' }
$previous = $env:HOOK_ENABLE_LOOM_HOOK
try {
    foreach ($value in @($null, '0')) {
        $env:HOOK_ENABLE_LOOM_HOOK = $value
        $expected = if ($null -eq $value) { '1' } else { $value }
        & cmd.exe /d /c ('"' + $launcher + '"')
        if ($LASTEXITCODE -ne 0) { throw 'Launcher failed.' }
        $result = Join-Path $root 'result.txt'
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        while (-not (Test-Path -LiteralPath $result) -or [IO.File]::ReadAllText($result) -ne $expected) {
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Launcher child did not report expected policy.' }
            Start-Sleep -Milliseconds 50
        }
        if ($env:HOOK_ENABLE_LOOM_HOOK -ne $value) { throw 'Launcher changed the parent environment.' }
    }
    $rejected = $false
    try { Write-HookLoomLauncher -HookExe $exe | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Existing launcher was overwritten.' }
} finally {
    $env:HOOK_ENABLE_LOOM_HOOK = $previous
}
Write-Output '[hook-loom-launcher] Passed: default enabled, explicit disable preserved, parent unchanged, no BOM, no overwrite.'
