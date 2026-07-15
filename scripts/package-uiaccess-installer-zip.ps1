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
$installHelperPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "install-hook-uiaccess.ps1"))
$assetName = "hook-windows-uiaccess-installer-$Tag.zip"
$zipPath = Join-Path $resolvedOutputDir $assetName

if ($DryRun) {
    [ordered]@{
        exePath = $resolvedExePath
        installHelperPath = $installHelperPath
        outputDir = $resolvedOutputDir
        assetName = $assetName
        zipPath = $zipPath
    } | ConvertTo-Json -Depth 5
    exit 0
}

if (-not (Test-Path -LiteralPath $resolvedExePath -PathType Leaf)) {
    throw "Missing signed Hook executable for installer packaging: $resolvedExePath"
}

if (-not (Test-Path -LiteralPath $installHelperPath -PathType Leaf)) {
    throw "Missing UIAccess install helper script: $installHelperPath"
}

$signature = Get-AuthenticodeSignature -LiteralPath $resolvedExePath
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "UIAccess installer packaging requires a digitally signed hook.exe because the installed binary must be trusted before it can run from Program Files."
}

if (-not (Test-Path -LiteralPath $resolvedOutputDir)) {
    New-Item -ItemType Directory -Path $resolvedOutputDir -Force | Out-Null
}

if ((Test-Path -LiteralPath $zipPath -PathType Leaf) -and -not $Force) {
    throw "Installer zip already exists. Re-run with -Force to replace it: $zipPath"
}

if (Test-Path -LiteralPath $zipPath -PathType Leaf) {
    Remove-Item -LiteralPath $zipPath -Force
}

$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("hook-uiaccess-installer-" + [System.Guid]::NewGuid().ToString("N"))
$stagingExePath = Join-Path $stagingRoot "hook.exe"
$stagingInstallHelperPath = Join-Path $stagingRoot "install-hook-uiaccess.ps1"
$stagingWrapperPath = Join-Path $stagingRoot "install-hook.ps1"
$stagingReadmePath = Join-Path $stagingRoot "README.txt"

$wrapperScript = @'
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path ${env:ProgramFiles} "yamiyu\Hook")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$bundleRoot = Split-Path -Parent $PSCommandPath
$sourceExe = Join-Path $bundleRoot "hook.exe"
$installHelper = Join-Path $bundleRoot "install-hook-uiaccess.ps1"

& powershell -NoProfile -ExecutionPolicy Bypass -File $installHelper -SourceExe $sourceExe -InstallDir $InstallDir
'@

$readme = @'
Hook UIAccess installer package

Contents:
- hook.exe
- install-hook.ps1
- install-hook-uiaccess.ps1

Why this package exists:
- Hook's UIAccess path is only honored by Windows when the signed binary is
  installed into a trusted location such as Program Files.
- This package is the recommended option for users who need the best chance of
  staying interactive when special Windows foreground windows such as Task Manager
  are active.

How to install:
1. Extract this zip.
2. Run install-hook.ps1 from an elevated PowerShell session.
3. Launch Hook from the installed Program Files location after setup completes.

Portable note:
- The normal portable zip is still useful for quick testing, but it may hit
  Windows foreground/elevation limits in scenarios where UIAccess is required.
'@

try {
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    Copy-Item -LiteralPath $resolvedExePath -Destination $stagingExePath -Force
    Copy-Item -LiteralPath $installHelperPath -Destination $stagingInstallHelperPath -Force
    Set-Content -LiteralPath $stagingWrapperPath -Value $wrapperScript -Encoding UTF8
    Set-Content -LiteralPath $stagingReadmePath -Value $readme -Encoding UTF8
    Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}

Write-Host "[hook-uiaccess-installer-package] Created:"
Write-Host "  $zipPath"
