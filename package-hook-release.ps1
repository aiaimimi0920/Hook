[CmdletBinding()]
param(
    [string]$OutputDir = "..\release\Hook",
    [switch]$Force,
    [switch]$DryRun,
    [switch]$RequireCleanSource
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$hookRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localBuildScript = Join-Path $hookRoot "scripts\build-local-hook-exe.ps1"
if (-not (Test-Path -LiteralPath $localBuildScript -PathType Leaf)) {
    throw "Missing Hook-local build script: $localBuildScript"
}

$arguments = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $localBuildScript,
    "-OutputDir",
    $OutputDir
)

if ($Force) {
    $arguments += "-Force"
}

if ($DryRun) {
    $arguments += "-DryRun"
}

if ($RequireCleanSource) {
    $arguments += "-RequireCleanSource"
}

& powershell.exe @arguments
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    exit $exitCode
}
