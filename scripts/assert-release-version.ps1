[CmdletBinding()]
param(
    [string]$Tag,
    [switch]$RequireTagAtHead,
    [string]$RequireReachableFromBranch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$packageLockRaw = Get-Content -LiteralPath (Join-Path $repoRoot "package-lock.json") -Raw
$tauriConfig = Get-Content -LiteralPath (Join-Path $repoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$cargoToml = Get-Content -LiteralPath (Join-Path $repoRoot "src-tauri\Cargo.toml") -Raw
$cargoLock = Get-Content -LiteralPath (Join-Path $repoRoot "src-tauri\Cargo.lock") -Raw

$cargoTomlMatch = [regex]::Match($cargoToml, '(?m)^version\s*=\s*"([^"]+)"')
if (-not $cargoTomlMatch.Success) {
    throw "Could not read the Hook package version from src-tauri/Cargo.toml."
}

$cargoLockMatch = [regex]::Match($cargoLock, '(?ms)\[\[package\]\]\s+name\s*=\s*"hook"\s+version\s*=\s*"([^"]+)"')
if (-not $cargoLockMatch.Success) {
    throw "Could not read the Hook package version from src-tauri/Cargo.lock."
}

$packageLockVersionMatch = [regex]::Match(
    $packageLockRaw,
    '(?s)^\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"version"\s*:\s*"([^"]+)"'
)
if (-not $packageLockVersionMatch.Success) {
    throw "Could not read the top-level version from package-lock.json."
}

$packageLockRootVersionMatch = [regex]::Match(
    $packageLockRaw,
    '(?s)"packages"\s*:\s*\{\s*""\s*:\s*\{.*?"version"\s*:\s*"([^"]+)"'
)
if (-not $packageLockRootVersionMatch.Success) {
    throw "Could not read the root package version from package-lock.json."
}

$versions = [ordered]@{
    "package.json" = [string]$packageJson.version
    "package-lock.json" = $packageLockVersionMatch.Groups[1].Value
    "package-lock.json root package" = $packageLockRootVersionMatch.Groups[1].Value
    "src-tauri/Cargo.toml" = $cargoTomlMatch.Groups[1].Value
    "src-tauri/Cargo.lock" = $cargoLockMatch.Groups[1].Value
    "src-tauri/tauri.conf.json" = [string]$tauriConfig.version
}

$metadataVersion = [string]$packageJson.version
if ($metadataVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw "Hook product version must use strict SemVer X.Y.Z. Received: $metadataVersion"
}

$expectedVersion = $metadataVersion
if (-not [string]::IsNullOrWhiteSpace($Tag)) {
    if ($Tag -notmatch '^V(\d+\.\d+\.\d+)$') {
        throw "Release tag must match Vx.x.x. Received: $Tag"
    }
    $expectedVersion = $Matches[1]
}

$mismatches = @($versions.GetEnumerator() | Where-Object { $_.Value -ne $expectedVersion })
if ($mismatches.Count -gt 0) {
    $details = $mismatches | ForEach-Object { "$($_.Key)=$($_.Value)" }
    throw "Release version $expectedVersion does not match all product metadata: $($details -join ', ')"
}

if (($RequireTagAtHead -or -not [string]::IsNullOrWhiteSpace($RequireReachableFromBranch)) -and [string]::IsNullOrWhiteSpace($Tag)) {
    throw "A release tag is required for Git provenance validation."
}

if (-not [string]::IsNullOrWhiteSpace($Tag)) {
    Push-Location -LiteralPath $repoRoot
    try {
        $tagCommit = (& git rev-parse "$Tag^{commit}").Trim()
        if ($LASTEXITCODE -ne 0) {
            throw "Could not resolve release tag $Tag."
        }

        if ($RequireTagAtHead) {
            $headCommit = (& git rev-parse HEAD).Trim()
            if ($LASTEXITCODE -ne 0) {
                throw "Could not resolve HEAD."
            }

            if ($tagCommit -ne $headCommit) {
                throw "Release tag $Tag resolves to $tagCommit but the checked-out HEAD is $headCommit."
            }
        }

        if (-not [string]::IsNullOrWhiteSpace($RequireReachableFromBranch)) {
            $branchCommit = (& git rev-parse "$RequireReachableFromBranch^{commit}").Trim()
            if ($LASTEXITCODE -ne 0) {
                throw "Could not resolve protected release branch $RequireReachableFromBranch."
            }

            & git merge-base --is-ancestor $tagCommit $branchCommit
            $ancestorExitCode = $LASTEXITCODE
            if ($ancestorExitCode -eq 1) {
                throw "Release tag $Tag ($tagCommit) is not reachable from protected release branch $RequireReachableFromBranch ($branchCommit)."
            }
            if ($ancestorExitCode -ne 0) {
                throw "Could not verify release tag ancestry for $Tag against $RequireReachableFromBranch."
            }
        }
    }
    finally {
        Pop-Location
    }
}

$scope = if ([string]::IsNullOrWhiteSpace($Tag)) { "metadata" } else { $Tag }
Write-Host "[hook-release-version] $scope matches all product version fields ($expectedVersion)."
