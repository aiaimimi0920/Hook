[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceExe,
    [string]$InstallDir = (Join-Path ${env:ProgramFiles} "yamiyu\\Hook")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    throw "Installing the uiAccess build into Program Files requires an elevated PowerShell session."
}

$resolvedSourceExe = [System.IO.Path]::GetFullPath($SourceExe)
if (-not (Test-Path -LiteralPath $resolvedSourceExe -PathType Leaf)) {
    throw "UIAccess source exe not found: $resolvedSourceExe"
}

$signature = Get-AuthenticodeSignature -LiteralPath $resolvedSourceExe
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Windows only honors uiAccess for a digitally signed executable. Sign hook.exe before install."
}

$resolvedInstallDir = [System.IO.Path]::GetFullPath($InstallDir)
if (-not (Test-Path -LiteralPath $resolvedInstallDir)) {
    New-Item -ItemType Directory -Path $resolvedInstallDir -Force | Out-Null
}

$targetExe = Join-Path $resolvedInstallDir "hook.exe"
Copy-Item -LiteralPath $resolvedSourceExe -Destination $targetExe -Force

Write-Host "[hook-uiaccess-install] Installed signed uiAccess build to trusted location:"
Write-Host "  $targetExe"
Write-Host "[hook-uiaccess-install] Reminder: uiAccess requires a digitally signed binary and a trusted location such as Program Files."
