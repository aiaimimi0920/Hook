[CmdletBinding()]
param(
    [string]$OutputDir = "..\release\Otter",
    [switch]$Force,
    [switch]$DryRun,
    [switch]$RequireCleanSource
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$otterRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localBuildScript = Join-Path $otterRoot "scripts\build-local-otter-exe.ps1"
if (-not (Test-Path -LiteralPath $localBuildScript -PathType Leaf)) {
    throw "Missing Otter-local build script: $localBuildScript"
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
