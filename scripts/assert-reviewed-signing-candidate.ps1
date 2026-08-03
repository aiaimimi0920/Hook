[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExePath,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedTag,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedCommit,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedRunId,

    [Parameter(Mandatory = $true)]
    [string]$ReviewedSha256
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$resolvedExePath = [System.IO.Path]::GetFullPath($ExePath)
$resolvedManifestPath = [System.IO.Path]::GetFullPath($ManifestPath)

if (-not (Test-Path -LiteralPath $resolvedExePath -PathType Leaf)) {
    throw "Missing reviewed signing candidate: $resolvedExePath"
}
if (-not (Test-Path -LiteralPath $resolvedManifestPath -PathType Leaf)) {
    throw "Missing reviewed signing candidate manifest: $resolvedManifestPath"
}
if ($ReviewedSha256 -notmatch '^[0-9A-Fa-f]{64}$') {
    throw "Reviewed SHA-256 must contain exactly 64 hexadecimal characters."
}

$manifest = Get-Content -LiteralPath $resolvedManifestPath -Raw | ConvertFrom-Json
$actualSha256 = (Get-FileHash -LiteralPath $resolvedExePath -Algorithm SHA256).Hash.ToLowerInvariant()
$reviewedSha256 = $ReviewedSha256.ToLowerInvariant()
$manifestSha256 = ([string]$manifest.sha256).ToLowerInvariant()

$checks = [ordered]@{
    "manifest schemaVersion" = ([string]$manifest.schemaVersion -eq "1")
    "manifest artifact" = ([string]$manifest.artifact -eq "hook.exe")
    "manifest tag" = ([string]$manifest.tag -eq $ExpectedTag)
    "manifest commit" = ([string]$manifest.commit -eq $ExpectedCommit)
    "manifest runId" = ([string]$manifest.runId -eq $ExpectedRunId)
    "manifest SHA-256 format" = ($manifestSha256 -match '^[0-9a-f]{64}$')
    "reviewed SHA-256 equals manifest" = ($reviewedSha256 -eq $manifestSha256)
    "candidate SHA-256 equals manifest" = ($actualSha256 -eq $manifestSha256)
}

$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value })
if ($failed.Count -gt 0) {
    throw "Signing candidate provenance validation failed: $((($failed | ForEach-Object Key) -join ', '))"
}

Write-Host "[hook-signing-candidate] Reviewed artifact digest verified: $actualSha256"
