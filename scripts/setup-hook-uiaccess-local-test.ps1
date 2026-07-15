[CmdletBinding()]
param(
    [string]$Subject = "CN=yamiyu Hook UIAccess Local Test",
    [string]$OutputDir = "..\\release\\Hook\\uiaccess-local-test",
    [string]$InstallDir = (Join-Path ${env:ProgramFiles} "yamiyu\\Hook"),
    [switch]$ReuseExistingCertificate
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
    throw "Setting up a local uiAccess test build requires an elevated PowerShell session because it writes to Program Files and LocalMachine certificate stores."
}

$hookRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$buildScript = Join-Path $hookRoot "scripts\build-local-hook-exe.ps1"
$installScript = Join-Path $hookRoot "scripts\install-hook-uiaccess.ps1"
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $hookRoot $OutputDir))
$builtExe = Join-Path $outputRoot "hook.exe"
$trustedRootStorePath = "Cert:\LocalMachine\Root"
$trustedPublisherStorePath = "Cert:\LocalMachine\TrustedPublisher"

function Get-OrCreateUiAccessCodeSigningCertificate {
    param(
        [string]$CertificateSubject,
        [switch]$ReuseExisting
    )

    if ($ReuseExisting) {
        $existing = Get-ChildItem -Path "Cert:\LocalMachine\My" |
            Where-Object { $_.Subject -eq $CertificateSubject -and $_.EnhancedKeyUsageList.FriendlyName -contains "Code Signing" } |
            Sort-Object NotAfter -Descending |
            Select-Object -First 1
        if ($existing) {
            return $existing
        }
    }

    return New-SelfSignedCertificate `
        -Subject $CertificateSubject `
        -Type CodeSigningCert `
        -CertStoreLocation "Cert:\LocalMachine\My" `
        -KeyExportPolicy Exportable `
        -NotAfter (Get-Date).AddYears(5) `
        -HashAlgorithm "SHA256"
}

$certificate = Get-OrCreateUiAccessCodeSigningCertificate `
    -CertificateSubject $Subject `
    -ReuseExisting:$ReuseExistingCertificate

# UIAccess trust must be anchored in LocalMachine stores, not just CurrentUser.
# Keep the canonical certificate provider paths visible for operators:
# - $trustedRootStorePath
# - $trustedPublisherStorePath

$rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "LocalMachine")
$rootStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
try {
    if (-not $rootStore.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $certificate.Thumbprint, $false).Count) {
        $rootStore.Add($certificate)
    }
} finally {
    $rootStore.Close()
}

$publisherStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPublisher", "LocalMachine")
$publisherStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
try {
    if (-not $publisherStore.Certificates.Find([System.Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $certificate.Thumbprint, $false).Count) {
        $publisherStore.Add($certificate)
    }
} finally {
    $publisherStore.Close()
}

& powershell -NoProfile -ExecutionPolicy Bypass -File $buildScript `
    -UiAccess `
    -AllowUnsignedUiAccessBuild `
    -OutputDir $OutputDir `
    -Force

if (-not (Test-Path -LiteralPath $builtExe -PathType Leaf)) {
    throw "Expected UIAccess build is missing: $builtExe"
}

$signature = Set-AuthenticodeSignature -LiteralPath $builtExe -Certificate $certificate
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Signing hook.exe failed: $($signature.StatusMessage)"
}

& powershell -NoProfile -ExecutionPolicy Bypass -File $installScript `
    -SourceExe $builtExe `
    -InstallDir $InstallDir

Write-Host "[hook-uiaccess-local-test] Ready."
Write-Host "  Signed build : $builtExe"
Write-Host "  Install path : $(Join-Path $InstallDir 'hook.exe')"
Write-Host "  Certificate  : $($certificate.Thumbprint)"
