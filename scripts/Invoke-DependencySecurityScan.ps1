[CmdletBinding()]
param(
    [string]$ScannerPath,
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$policy = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot "security\dependency-security-policy.json") | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($ScannerPath)) {
    $ScannerPath = Join-Path $repoRoot ".tmp\tools\osv-scanner-v$($policy.scanner.version).exe"
    & (Join-Path $PSScriptRoot "Install-OsvScanner.ps1") -Destination $ScannerPath | Out-Null
} elseif (-not [System.IO.Path]::IsPathRooted($ScannerPath)) {
    $ScannerPath = Join-Path $repoRoot $ScannerPath
}
$ScannerPath = [System.IO.Path]::GetFullPath($ScannerPath)
if (-not (Test-Path -LiteralPath $ScannerPath -PathType Leaf)) {
    throw "OSV-Scanner executable not found: $ScannerPath"
}
$actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ScannerPath).Hash.ToLowerInvariant()
$expectedHash = ([string]$policy.scanner.windowsX64Sha256).ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
    throw "OSV-Scanner SHA-256 mismatch. Expected $expectedHash, received $actualHash."
}
$versionText = (& $ScannerPath --version | Out-String)
if ($LASTEXITCODE -ne 0 -or $versionText -notmatch "osv-scanner version:\s*$([regex]::Escape([string]$policy.scanner.version))") {
    throw "OSV-Scanner must be version $($policy.scanner.version). Received: $($versionText.Trim())"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repoRoot "$($policy.evidenceDirectory)\osv-results.json"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = Join-Path $repoRoot $OutputPath
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath) | Out-Null

$arguments = @("scan", "--format=json", "--output-file=$OutputPath", "--config=$(Join-Path $repoRoot ([string]$policy.config))")
foreach ($relativePath in $policy.lockfiles) {
    $lockfile = Join-Path $repoRoot ([string]$relativePath)
    if (-not (Test-Path -LiteralPath $lockfile -PathType Leaf)) {
        throw "Configured lockfile does not exist: $relativePath"
    }
    $arguments += "--lockfile=$lockfile"
}

& $ScannerPath @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Dependency vulnerability scan failed with exit code $LASTEXITCODE. Evidence: $OutputPath"
}
Write-Output "Hook dependency vulnerability scan passed. Evidence: $OutputPath"
