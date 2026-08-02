[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packageJsonPath = Join-Path $repoRoot "package.json"
$packageLockPath = Join-Path $repoRoot "package-lock.json"
$cargoManifestPath = Join-Path $repoRoot "src-tauri\Cargo.toml"

$errors = New-Object System.Collections.Generic.List[string]
$forbiddenLicensePattern = '(?i)\b(UNLICENSED|PROPRIETARY|NOASSERTION)\b|LicenseRef-Proprietary|SEE LICENSE IN'

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
if ([string]$packageJson.license -ne "MIT") {
    $errors.Add("package.json must declare the Hook project license as MIT.")
}

$directNpmPackages = @()
foreach ($sectionName in @("dependencies", "devDependencies")) {
    $section = $packageJson.$sectionName
    if ($null -eq $section) {
        continue
    }

    foreach ($property in $section.PSObject.Properties) {
        $directNpmPackages += $property.Name
    }
}

foreach ($packageName in ($directNpmPackages | Sort-Object -Unique)) {
    $manifestPath = Join-Path $repoRoot ("node_modules\" + ($packageName -replace '/', '\') + "\package.json")
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        $errors.Add("Missing installed npm manifest for direct dependency: $packageName. Run npm ci first.")
        continue
    }

    $dependencyManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $licenseText = if ($null -eq $dependencyManifest.license) { "" } else { [string]$dependencyManifest.license }
    if ([string]::IsNullOrWhiteSpace($licenseText)) {
        $errors.Add("Direct npm dependency has no license metadata: $packageName")
    }
    elseif ($licenseText -match $forbiddenLicensePattern) {
        $errors.Add("Direct npm dependency has a forbidden or unresolved license: $packageName ($licenseText)")
    }
}

$packageLockRaw = Get-Content -LiteralPath $packageLockPath -Raw
foreach ($licenseMatch in [regex]::Matches($packageLockRaw, '"license"\s*:\s*"([^"]+)"')) {
    $licenseText = $licenseMatch.Groups[1].Value
    if ($licenseText -match $forbiddenLicensePattern) {
        $errors.Add("package-lock.json contains a forbidden or unresolved license: $licenseText")
    }
}

$cargoJson = & cargo metadata --manifest-path $cargoManifestPath --format-version 1 --locked
if ($LASTEXITCODE -ne 0) {
    throw "cargo metadata failed with exit code $LASTEXITCODE."
}

$cargoMetadata = $cargoJson | ConvertFrom-Json
$rustLicenseExpressions = New-Object System.Collections.Generic.HashSet[string]
foreach ($package in $cargoMetadata.packages) {
    $licenseText = if ($null -eq $package.license) { "" } else { [string]$package.license }
    $licenseFile = if ($null -eq $package.license_file) { "" } else { [string]$package.license_file }

    if ([string]::IsNullOrWhiteSpace($licenseText) -and [string]::IsNullOrWhiteSpace($licenseFile)) {
        $errors.Add("Resolved Rust package has no license or license-file metadata: $($package.name) $($package.version)")
        continue
    }

    if (-not [string]::IsNullOrWhiteSpace($licenseText)) {
        [void]$rustLicenseExpressions.Add($licenseText)
        if ($licenseText -match $forbiddenLicensePattern) {
            $errors.Add("Resolved Rust package has a forbidden or unresolved license: $($package.name) $($package.version) ($licenseText)")
        }
    }
}

if ($errors.Count -gt 0) {
    $message = "Open-source dependency audit failed:`n- " + ($errors -join "`n- ")
    throw $message
}

Write-Host "[hook-license-audit] Direct npm manifests checked: $($directNpmPackages.Count)"
Write-Host "[hook-license-audit] Resolved Rust packages checked: $($cargoMetadata.packages.Count)"
Write-Host "[hook-license-audit] Rust license expressions observed: $($rustLicenseExpressions.Count)"
Write-Host "[hook-license-audit] No explicit proprietary, unlicensed, or unresolved license marker was found."
