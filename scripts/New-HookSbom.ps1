[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][string]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

function Write-Utf8NoBom {
    param([string]$Path, [string]$Value)
    [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}
function Get-Purl {
    param([string]$Type, [string]$Name, [string]$PackageVersion)
    return "pkg:${Type}/$([Uri]::EscapeDataString($Name))@$([Uri]::EscapeDataString($PackageVersion))"
}
function Add-Component {
    param([System.Collections.Specialized.OrderedDictionary]$Map, [string]$Type, [string]$Name, [string]$PackageVersion)
    $purl = Get-Purl -Type $Type -Name $Name -PackageVersion $PackageVersion
    if (-not $Map.Contains($purl)) {
        $Map[$purl] = [ordered]@{ type = "library"; name = $Name; version = $PackageVersion; purl = $purl; "bom-ref" = $purl }
    }
}

$componentsByRef = [ordered]@{}
$cargoLocks = @(
    "src-tauri\Cargo.lock",
    "src-tauri\crates\drag\Cargo.lock",
    "src-tauri\crates\scap-direct3d\Cargo.lock"
)
foreach ($relativePath in $cargoLocks) {
    $text = [System.IO.File]::ReadAllText((Join-Path $repoRoot $relativePath), [System.Text.Encoding]::UTF8)
    foreach ($match in [regex]::Matches($text, '(?ms)^\[\[package\]\]\s+name\s*=\s*"([^"]+)"\s+version\s*=\s*"([^"]+)"')) {
        Add-Component -Map $componentsByRef -Type "cargo" -Name $match.Groups[1].Value -PackageVersion $match.Groups[2].Value
    }
}

$packageLockPath = Join-Path $repoRoot "package-lock.json"
$previousPath = $env:HOOK_SBOM_PACKAGE_LOCK
try {
    $env:HOOK_SBOM_PACKAGE_LOCK = $packageLockPath
    $nodeOutput = & node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.env.HOOK_SBOM_PACKAGE_LOCK,'utf8'));process.stdout.write(JSON.stringify(Object.values(p.packages||{}).filter(x=>x&&x.name&&x.version).map(x=>({name:x.name,version:x.version}))));" 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Node.js failed to parse package-lock.json for the SBOM." }
} finally {
    $env:HOOK_SBOM_PACKAGE_LOCK = $previousPath
}
foreach ($entry in @(($nodeOutput -join "`n") | ConvertFrom-Json)) {
    Add-Component -Map $componentsByRef -Type "npm" -Name ([string]$entry.name) -PackageVersion ([string]$entry.version)
}

$components = @($componentsByRef.Values | Sort-Object { [string]$_['bom-ref'] })
$timestamp = [DateTimeOffset]::UtcNow.ToString("o")
$productRef = "pkg:generic/hook@$([Uri]::EscapeDataString($Version))"
$cycloneDx = [ordered]@{
    bomFormat = "CycloneDX"; specVersion = "1.6"; serialNumber = "urn:uuid:$([Guid]::NewGuid())"; version = 1
    metadata = [ordered]@{
        timestamp = $timestamp
        tools = @([ordered]@{ vendor = "Neuro"; name = "New-HookSbom.ps1"; version = "1" })
        component = [ordered]@{ type = "application"; name = "Hook"; version = $Version; "bom-ref" = $productRef }
    }
    components = $components
}

$spdxPackages = @()
$index = 0
foreach ($component in $components) {
    $index++
    $spdxPackages += [ordered]@{
        SPDXID = "SPDXRef-Package-$index"; name = $component.name; versionInfo = $component.version
        downloadLocation = "NOASSERTION"; filesAnalyzed = $false; licenseConcluded = "NOASSERTION"
        licenseDeclared = "NOASSERTION"; copyrightText = "NOASSERTION"
        externalRefs = @([ordered]@{ referenceCategory = "PACKAGE-MANAGER"; referenceType = "purl"; referenceLocator = $component.purl })
    }
}
$spdx = [ordered]@{
    spdxVersion = "SPDX-2.3"; dataLicense = "CC0-1.0"; SPDXID = "SPDXRef-DOCUMENT"; name = "Hook-$Version"
    documentNamespace = "https://github.com/aiaimimi0920/Hook/sbom/$([Guid]::NewGuid())"
    creationInfo = [ordered]@{ created = $timestamp; creators = @("Tool: New-HookSbom.ps1-1") }
    packages = $spdxPackages
}

$cyclonePath = Join-Path $outputRoot "Hook-$Version.cdx.json"
$spdxPath = Join-Path $outputRoot "Hook-$Version.spdx.json"
Write-Utf8NoBom -Path $cyclonePath -Value (($cycloneDx | ConvertTo-Json -Depth 20) + "`n")
Write-Utf8NoBom -Path $spdxPath -Value (($spdx | ConvertTo-Json -Depth 20) + "`n")
[ordered]@{ schemaVersion = 1; componentCount = $components.Count; cycloneDx = $cyclonePath; spdx = $spdxPath } | ConvertTo-Json
