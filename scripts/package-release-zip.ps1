[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExePath,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [switch]$Force,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$resolvedExePath = [System.IO.Path]::GetFullPath($ExePath)
$resolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$projectLicensePath = Join-Path $repoRoot "LICENSE"
$thirdPartyNoticesPath = Join-Path $repoRoot "THIRD_PARTY_NOTICES.md"
$capLicensePath = Join-Path $repoRoot "src-tauri\crates\LICENSE_CAP_SCAP_MIT"
$dragApacheLicensePath = Join-Path $repoRoot "src-tauri\crates\drag\LICENSE_APACHE-2.0"
$dragMitLicensePath = Join-Path $repoRoot "src-tauri\crates\drag\LICENSE_MIT"
$assetName = "hook-windows-x64-$Tag.zip"
$zipPath = Join-Path $resolvedOutputDir $assetName

if ($DryRun) {
    [ordered]@{
        exePath = $resolvedExePath
        outputDir = $resolvedOutputDir
        assetName = $assetName
        zipPath = $zipPath
    } | ConvertTo-Json -Depth 5
    exit 0
}

if (-not (Test-Path -LiteralPath $resolvedExePath -PathType Leaf)) {
    throw "Missing Hook executable for release packaging: $resolvedExePath"
}

foreach ($requiredPath in @(
    $projectLicensePath,
    $thirdPartyNoticesPath,
    $capLicensePath,
    $dragApacheLicensePath,
    $dragMitLicensePath
)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Missing required release notice or license file: $requiredPath"
    }
}

if (-not (Test-Path -LiteralPath $resolvedOutputDir)) {
    New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null
}

if ((Test-Path -LiteralPath $zipPath -PathType Leaf) -and -not $Force) {
    throw "Release zip already exists. Re-run with -Force to replace it: $zipPath"
}

if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
    Remove-Item -LiteralPath $zipPath -Force
}

$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("hook-release-" + [System.Guid]::NewGuid().ToString("N"))
$stagingFile = Join-Path $stagingRoot "hook.exe"
$stagingThirdPartyRoot = Join-Path $stagingRoot "third-party-licenses"

try {
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $stagingThirdPartyRoot -Force | Out-Null
    Copy-Item -LiteralPath $resolvedExePath -Destination $stagingFile -Force
    Copy-Item -LiteralPath $projectLicensePath -Destination (Join-Path $stagingRoot "LICENSE.txt") -Force
    Copy-Item -LiteralPath $thirdPartyNoticesPath -Destination (Join-Path $stagingRoot "THIRD_PARTY_NOTICES.md") -Force
    Copy-Item -LiteralPath $capLicensePath -Destination (Join-Path $stagingThirdPartyRoot "CAP_SCAP_MIT.txt") -Force
    Copy-Item -LiteralPath $dragApacheLicensePath -Destination (Join-Path $stagingThirdPartyRoot "DRAG_APACHE-2.0.txt") -Force
    Copy-Item -LiteralPath $dragMitLicensePath -Destination (Join-Path $stagingThirdPartyRoot "DRAG_MIT.txt") -Force
    Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}

Write-Host "[hook-release-package] Created:"
Write-Host "  $zipPath"
