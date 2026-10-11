[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExePath,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^V\d+\.\d+\.\d+$')]
    [string]$Tag,

    [string]$ExtensionCompatibilityPath = "",

    [switch]$Force,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$resolvedExePath = [System.IO.Path]::GetFullPath($ExePath)
$resolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$fileHashScript = Join-Path $PSScriptRoot "file-hash.ps1"
. $fileHashScript
. (Join-Path $PSScriptRoot "release\PathSafety.ps1")
$projectLicensePath = Join-Path $repoRoot "LICENSE"
$thirdPartyNoticesPath = Join-Path $repoRoot "THIRD_PARTY_NOTICES.md"
$capLicensePath = Join-Path $repoRoot "src-tauri\crates\LICENSE_CAP_SCAP_MIT"
$dragApacheLicensePath = Join-Path $repoRoot "src-tauri\crates\drag\LICENSE_APACHE-2.0"
$dragMitLicensePath = Join-Path $repoRoot "src-tauri\crates\drag\LICENSE_MIT"
$assetName = "otter-windows-x64-$Tag.zip"
$zipPath = Join-Path $resolvedOutputDir $assetName
$provenancePath = Join-Path (Split-Path -Parent $resolvedExePath) "build-provenance.json"
$resolvedCompatibilityPath = $null
if (-not [string]::IsNullOrWhiteSpace($ExtensionCompatibilityPath)) {
    $resolvedCompatibilityPath = [System.IO.Path]::GetFullPath($ExtensionCompatibilityPath)
}

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
    throw "Missing Otter executable for release packaging: $resolvedExePath"
}
$resolvedExePath = Assert-OtterAbsolutePathNoReparsePoints -Path $resolvedExePath -TrustedRootPath (Split-Path -Parent $resolvedExePath)
if ($null -ne $resolvedCompatibilityPath) {
    if (-not (Test-Path -LiteralPath $resolvedCompatibilityPath -PathType Leaf)) {
        throw "Missing extension compatibility evidence: $resolvedCompatibilityPath"
    }
    [void](Assert-OtterAbsolutePathNoReparsePoints -Path $resolvedCompatibilityPath -TrustedRootPath (Split-Path -Parent $resolvedCompatibilityPath))
}

if (-not (Test-Path -LiteralPath $provenancePath -PathType Leaf)) {
    throw "Missing Otter build provenance beside executable: $provenancePath"
}
$provenancePath = Assert-OtterAbsolutePathNoReparsePoints -Path $provenancePath -TrustedRootPath (Split-Path -Parent $provenancePath)
$provenance = Read-OtterBoundedText -Path $provenancePath -MaxBytes 1MB | ConvertFrom-Json
$expectedName = Split-Path -Leaf $resolvedExePath
$actualSha256 = Get-OtterFileSha256 -Path $resolvedExePath
if ([string]$provenance.artifact.name -ne $expectedName -or [string]$provenance.artifact.sha256 -ne $actualSha256) {
    throw "Otter build provenance does not match the executable being packaged: $provenancePath"
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
    Assert-OtterAbsolutePathNoReparsePoints -Path $requiredPath -TrustedRootPath $repoRoot | Out-Null
}

Assert-OtterAbsolutePathNoReparsePoints -Path $resolvedOutputDir -TrustedRootPath $resolvedOutputDir | Out-Null
if (-not (Test-Path -LiteralPath $resolvedOutputDir)) {
    New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null
}
Assert-OtterAbsolutePathNoReparsePoints -Path $resolvedOutputDir -TrustedRootPath $resolvedOutputDir | Out-Null

if ((Test-Path -LiteralPath $zipPath -PathType Leaf) -and -not $Force) {
    throw "Release zip already exists. Re-run with -Force to replace it: $zipPath"
}

if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
    Assert-OtterAbsolutePathNoReparsePoints -Path $zipPath -TrustedRootPath $resolvedOutputDir | Out-Null
    Remove-Item -LiteralPath $zipPath -Force
}

$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("otter-release-" + [System.Guid]::NewGuid().ToString("N"))
$stagingFile = Join-Path $stagingRoot "otter.exe"
$stagingThirdPartyRoot = Join-Path $stagingRoot "third-party-licenses"

try {
    Assert-OtterAbsolutePathNoReparsePoints -Path $stagingRoot -TrustedRootPath ([System.IO.Path]::GetTempPath()) | Out-Null
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $stagingThirdPartyRoot -Force | Out-Null
    Assert-OtterAbsolutePathNoReparsePoints -Path $stagingThirdPartyRoot -TrustedRootPath $stagingRoot | Out-Null
    Copy-Item -LiteralPath $resolvedExePath -Destination $stagingFile -Force
    Copy-Item -LiteralPath $provenancePath -Destination (Join-Path $stagingRoot "build-provenance.json") -Force
    if ($null -ne $resolvedCompatibilityPath) {
        Copy-Item -LiteralPath $resolvedCompatibilityPath -Destination (Join-Path $stagingRoot "extension-compatibility.json") -Force
    }
    Copy-Item -LiteralPath $projectLicensePath -Destination (Join-Path $stagingRoot "LICENSE.txt") -Force
    Copy-Item -LiteralPath $thirdPartyNoticesPath -Destination (Join-Path $stagingRoot "THIRD_PARTY_NOTICES.md") -Force
    Copy-Item -LiteralPath $capLicensePath -Destination (Join-Path $stagingThirdPartyRoot "CAP_SCAP_MIT.txt") -Force
    Copy-Item -LiteralPath $dragApacheLicensePath -Destination (Join-Path $stagingThirdPartyRoot "DRAG_APACHE-2.0.txt") -Force
    Copy-Item -LiteralPath $dragMitLicensePath -Destination (Join-Path $stagingThirdPartyRoot "DRAG_MIT.txt") -Force
    Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
    Assert-OtterAbsolutePathNoReparsePoints -Path $zipPath -TrustedRootPath $resolvedOutputDir | Out-Null
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}

Write-Host "[otter-release-package] Created:"
Write-Host "  $zipPath"
