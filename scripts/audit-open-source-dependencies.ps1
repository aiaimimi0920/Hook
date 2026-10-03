[CmdletBinding()]
param([string]$ReportPath = "artifacts/license-audit.json")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packageJsonPath = Join-Path $repoRoot "package.json"
$packageLockPath = Join-Path $repoRoot "package-lock.json"
$cargoManifestPath = Join-Path $repoRoot "src-tauri\Cargo.toml"

$ReportPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $ReportPath))
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReportPath) | Out-Null
if (Test-Path -LiteralPath $ReportPath) { Remove-Item -LiteralPath $ReportPath -Force }
$facts = New-Object System.Collections.Generic.List[object]
$errors = New-Object System.Collections.Generic.List[string]
$forbiddenLicensePattern = '(?i)\b(UNLICENSED|PROPRIETARY|NOASSERTION)\b|LicenseRef-Proprietary|SEE LICENSE IN'

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$facts.Add(@{ source = "project"; name = "hook"; license = [string]$packageJson.license })
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
        throw "Missing installed npm manifest for direct dependency: $packageName. Run npm ci first."
    }

    $dependencyManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $licenseText = if ($null -eq $dependencyManifest.PSObject.Properties["license"]) { "" } else { [string]$dependencyManifest.license }
    $facts.Add(@{ source = "npm-direct"; name = $packageName; version = [string]$dependencyManifest.version; license = $licenseText })
    if ([string]::IsNullOrWhiteSpace($licenseText)) {
        $errors.Add("Direct npm dependency has no license metadata: $packageName")
    }
    elseif ($licenseText -match $forbiddenLicensePattern) {
        $errors.Add("Direct npm dependency has a forbidden or unresolved license: $packageName ($licenseText)")
    }
}

$npmLockJson = & node (Join-Path $PSScriptRoot "security\npm-license-inventory.cjs") $packageLockPath
if ($LASTEXITCODE -ne 0) { throw "Invalid npm lockfile inventory." }
$npmLockFacts = $npmLockJson | ConvertFrom-Json
foreach ($fact in $npmLockFacts) {
    $facts.Add($fact)
    $licenseText = [string]$fact.license
    if ($licenseText -match $forbiddenLicensePattern) {
        $errors.Add("package-lock.json contains a forbidden or unresolved license: $($fact.location) ($licenseText)")
    }
}

$cargoJson = & cargo metadata --manifest-path $cargoManifestPath --format-version 1 --locked
if ($LASTEXITCODE -ne 0) {
    throw "cargo metadata failed with exit code $LASTEXITCODE."
}

$cargoMetadata = $cargoJson | ConvertFrom-Json
if ($null -eq $cargoMetadata.packages -or $cargoMetadata.packages.Count -eq 0) { throw "Incomplete cargo metadata." }
$rustLicenseExpressions = New-Object System.Collections.Generic.HashSet[string]
foreach ($package in $cargoMetadata.packages) {
    $licenseText = if ($null -eq $package.license) { "" } else { [string]$package.license }
    $licenseFile = if ($null -eq $package.license_file) { "" } else { [string]$package.license_file }

    $facts.Add(@{ source = "cargo"; name = [string]$package.name; version = [string]$package.version; license = $licenseText; licenseFile = $licenseFile })
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

$report = @{ schemaVersion = 1; complete = $true; directNpmCount = $directNpmPackages.Count; rustCount = $cargoMetadata.packages.Count; facts = @($facts.ToArray()); findings = @($errors.ToArray()) }
[System.IO.File]::WriteAllText($ReportPath, ($report | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
if ($errors.Count -gt 0) {
    $message = "Open-source dependency audit failed:`n- " + ($errors -join "`n- ")
    throw $message
}

Write-Host "[hook-license-audit] Direct npm manifests checked: $($directNpmPackages.Count)"
Write-Host "[hook-license-audit] Resolved Rust packages checked: $($cargoMetadata.packages.Count)"
Write-Host "[hook-license-audit] Rust license expressions observed: $($rustLicenseExpressions.Count)"
Write-Host "[hook-license-audit] No explicit proprietary, unlicensed, or unresolved license marker was found."
