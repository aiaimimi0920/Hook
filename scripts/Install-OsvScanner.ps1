[CmdletBinding()]
param([string]$Destination)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$policy = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot "security\dependency-security-policy.json") | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $repoRoot ".tmp\tools\osv-scanner-v$($policy.scanner.version).exe"
} elseif (-not [System.IO.Path]::IsPathRooted($Destination)) {
    $Destination = Join-Path $repoRoot $Destination
}
$Destination = [System.IO.Path]::GetFullPath($Destination)

function Assert-ScannerHash {
    param([string]$Path)
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    $expected = ([string]$policy.scanner.windowsX64Sha256).ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "OSV-Scanner SHA-256 mismatch. Expected $expected, received $actual."
    }
}

if (Test-Path -LiteralPath $Destination -PathType Leaf) {
    Assert-ScannerHash -Path $Destination
    Write-Output $Destination
    exit 0
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
$temporary = "$Destination.$([Guid]::NewGuid().ToString('N')).download"
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $policy.scanner.windowsX64Url -OutFile $temporary
    Assert-ScannerHash -Path $temporary
    Move-Item -Force -LiteralPath $temporary -Destination $Destination
    Assert-ScannerHash -Path $Destination
} finally {
    Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $temporary
}

Write-Output $Destination
