[CmdletBinding()]
param(
    [string]$Tag = "",
    [switch]$NoUpx,
    [switch]$NoZip,
    [switch]$Force,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$hookRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $hookRoot
$releaseScript = Join-Path $repoRoot "scripts\build-release-exes.ps1"

if (-not (Test-Path -LiteralPath $releaseScript -PathType Leaf)) {
    throw "Missing canonical Neuro release script: $releaseScript"
}

if ($NoUpx) {
    Write-Verbose "-NoUpx is accepted for compatibility. Canonical Neuro release packaging does not create UPX variants."
}

$arguments = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $releaseScript,
    "-Apps",
    "Hook"
)

if (-not [string]::IsNullOrWhiteSpace($Tag)) {
    $arguments += @("-VersionId", $Tag)
}

if ($NoZip) {
    $arguments += "-NoZip"
}

if ($Force) {
    $arguments += "-Force"
}

if ($DryRun) {
    $arguments += "-DryRun"
}

& powershell.exe @arguments
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
    exit $exitCode
}
