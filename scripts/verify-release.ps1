[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackageDir,
    [switch]$RequireCleanSource,
    [switch]$RunSmoke,
    [switch]$RunHeadlessSmoke,
    [string]$SmokeArtifactRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
. (Join-Path $PSScriptRoot "file-hash.ps1")
. (Join-Path $PSScriptRoot "release\PathSafety.ps1")
. (Join-Path $PSScriptRoot "release\Manifest.ps1")
. (Join-Path $PSScriptRoot "release\ExtensionCompatibility.ps1")

function Assert-ReleaseCondition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function ConvertTo-RecordMap {
    param([object[]]$Records)
    $map = @{}
    foreach ($record in $Records) {
        $path = Assert-OtterSafeRelativePath -RelativePath ([string]$record.path)
        Assert-ReleaseCondition (-not $map.ContainsKey($path)) "Duplicate Otter release record: $path"
        $map[$path] = $record
    }
    return $map
}

if ($RunSmoke -and $RunHeadlessSmoke) {
    throw "Choose either native or headless Otter release smoke, not both."
}

$releaseRoot = [System.IO.Path]::GetFullPath($PackageDir)
Assert-ReleaseCondition (Test-Path -LiteralPath $releaseRoot -PathType Container) "Otter release directory is missing: $releaseRoot"
Assert-OtterNoReparsePoints -RootPath $releaseRoot -Path $releaseRoot
$manifestPath = Join-Path $releaseRoot "manifest.json"
$checksumsPath = Join-Path $releaseRoot "checksums.sha256"
foreach ($path in @($manifestPath, $checksumsPath)) {
    Assert-ReleaseCondition (Test-Path -LiteralPath $path -PathType Leaf) "Otter release metadata is missing: $path"
}

$manifest = Read-OtterBoundedText -Path $manifestPath -MaxBytes 4MB | ConvertFrom-Json
Assert-ReleaseCondition ([int]$manifest.schemaVersion -eq 1 -and [string]$manifest.app -eq "Otter") "Unsupported Otter release manifest."
Assert-ReleaseCondition ([string]$manifest.versionId -match '^V\d+\.\d+\.\d+$') "Otter release manifest has an invalid version."
Assert-ReleaseCondition ([string]$manifest.target -eq "windows-x64") "Otter release target must be windows-x64."
Assert-ReleaseCondition ([string]$manifest.gitHead -match '^[0-9a-f]{40}$') "Otter release source commit is invalid."
Assert-ReleaseCondition ($manifest.gitDirty -eq $false -and $manifest.sourceGitDirty -eq $false) "Formal Otter release provenance must record a clean source."

if ($RequireCleanSource) {
    $dirty = @(& git -C $repoRoot status --porcelain --untracked-files=all 2>$null)
    Assert-ReleaseCondition ($LASTEXITCODE -eq 0 -and $dirty.Count -eq 0) "Formal Otter verification requires a clean Git worktree."
    $head = (& git -C $repoRoot rev-parse HEAD).Trim()
    Assert-ReleaseCondition ($LASTEXITCODE -eq 0 -and $head -eq [string]$manifest.gitHead) "Release manifest does not match the current clean source commit."
}

$versionId = [string]$manifest.versionId
$zipName = "otter-windows-x64-$versionId.zip"
$expectedPublished = @(
    "packages\$zipName", "packages\$zipName.sha256",
    "sbom\Otter-$versionId.cdx.json", "sbom\Otter-$versionId.spdx.json",
    "provenance\build-provenance.json", "manifest.json", "checksums.sha256"
)
$actualPublished = @($manifest.publishedAssets | ForEach-Object { Assert-OtterSafeRelativePath -RelativePath ([string]$_) } | Sort-Object)
Assert-ReleaseCondition (($actualPublished -join "`n") -ceq (($expectedPublished | Sort-Object) -join "`n")) "Otter published asset set does not match the formal contract."

$recordMap = ConvertTo-RecordMap -Records @($manifest.files)
$actualFiles = @(Get-OtterSafeReleaseFiles -RootPath $releaseRoot)
$recordedActual = @($actualFiles | Where-Object { $_.Name -notin @("manifest.json", "checksums.sha256") })
Assert-ReleaseCondition ($recordMap.Count -eq $recordedActual.Count) "Otter release file inventory count does not match the manifest."
foreach ($file in $recordedActual) {
    $relative = Get-OtterReleaseRelativePath -RootPath $releaseRoot -Path $file.FullName
    Assert-ReleaseCondition ($recordMap.ContainsKey($relative)) "Unrecorded Otter release file: $relative"
    $digest = Get-OtterReleaseDigest -Path $file.FullName
    $record = $recordMap[$relative]
    Assert-ReleaseCondition ([int64]$record.bytes -eq $digest.bytes -and [string]$record.sha256 -ceq $digest.sha256) "Otter release file digest mismatch: $relative"
}

$checksumText = Read-OtterBoundedText -Path $checksumsPath -MaxBytes 4MB
$checksumMap = @{}
foreach ($line in @($checksumText -split '\r?\n' | Where-Object { $_.Length -gt 0 })) {
    $match = [regex]::Match($line, '^([0-9a-f]{64})  (.+)$')
    Assert-ReleaseCondition $match.Success "Invalid checksums.sha256 entry."
    $relative = (Assert-OtterSafeRelativePath -RelativePath $match.Groups[2].Value).Replace("/", "\")
    Assert-ReleaseCondition (-not $checksumMap.ContainsKey($relative)) "Duplicate checksum entry: $relative"
    $checksumMap[$relative] = $match.Groups[1].Value
}
$hashedFiles = @($actualFiles | Where-Object { $_.FullName -ne $checksumsPath })
Assert-ReleaseCondition ($checksumMap.Count -eq $hashedFiles.Count) "Otter checksum inventory is incomplete."
foreach ($file in $hashedFiles) {
    $relative = Get-OtterReleaseRelativePath -RootPath $releaseRoot -Path $file.FullName
    Assert-ReleaseCondition ($checksumMap[$relative] -ceq (Get-OtterFileSha256 -Path $file.FullName)) "Otter checksum mismatch: $relative"
}

$zipPath = Resolve-OtterReleasePath -RootPath $releaseRoot -RelativePath "packages\$zipName"
$compatibilityRecord = if ($null -ne $manifest.PSObject.Properties["extensionCompatibility"]) {
    $manifest.extensionCompatibility
} else { $null }
$expectedZipEntries = @(
    "build-provenance.json", "otter.exe", "LICENSE.txt", "THIRD_PARTY_NOTICES.md",
    "third-party-licenses\CAP_SCAP_MIT.txt", "third-party-licenses\DRAG_APACHE-2.0.txt",
    "third-party-licenses\DRAG_MIT.txt"
)
if ($null -ne $compatibilityRecord) {
    $expectedZipEntries += "extension-compatibility.json"
    $compatibilityPath = Resolve-OtterReleasePath -RootPath $releaseRoot -RelativePath ([string]$compatibilityRecord.path)
    $compatibility = Read-OtterExtensionCompatibility -Path $compatibilityPath
    Assert-OtterExtensionCompatibility -Document $compatibility -GitHead ([string]$manifest.gitHead) -ExecutablePath (Join-Path $releaseRoot "portable\otter.exe")
    $compatibilityDigest = Get-OtterReleaseDigest -Path $compatibilityPath
    $embeddedCompatibilityDigest = Get-OtterArchiveEntryDigest -ZipPath $zipPath -EntryName "extension-compatibility.json"
    Assert-ReleaseCondition ($compatibilityDigest.bytes -eq $embeddedCompatibilityDigest.bytes -and $compatibilityDigest.sha256 -ceq $embeddedCompatibilityDigest.sha256) "Embedded extension compatibility evidence does not match the release record."
}
$zipEntries = @(Get-OtterArchiveEntries -ZipPath $zipPath)
Assert-ReleaseCondition (($zipEntries -join "`n") -ceq (($expectedZipEntries | Sort-Object) -join "`n")) "Otter portable ZIP payload is not exact."
$portableExe = Resolve-OtterReleasePath -RootPath $releaseRoot -RelativePath "portable\otter.exe"
$portableDigest = Get-OtterReleaseDigest -Path $portableExe
$zipExeDigest = Get-OtterArchiveEntryDigest -ZipPath $zipPath -EntryName "otter.exe"
Assert-ReleaseCondition ($portableDigest.bytes -eq $zipExeDigest.bytes -and $portableDigest.sha256 -ceq $zipExeDigest.sha256) "Packaged otter.exe does not match the verified portable executable."
$embeddedProvenance = Read-OtterArchiveEntryText -ZipPath $zipPath -EntryName "build-provenance.json" -MaxBytes 1MB | ConvertFrom-Json
. (Join-Path $PSScriptRoot "version-identity.ps1")
Assert-OtterPublicBuildIdentity -Provenance $embeddedProvenance -ProductVersion $versionId.Substring(1)
Assert-ReleaseCondition ([int]$embeddedProvenance.schemaVersion -eq 1 -and [string]$embeddedProvenance.app -eq "Otter") "Embedded Otter build provenance is unsupported."
Assert-ReleaseCondition ([string]$embeddedProvenance.gitHead -ceq [string]$manifest.gitHead -and $embeddedProvenance.gitDirty -eq $false) "Embedded Otter build provenance does not match the formal source commit."
Assert-ReleaseCondition ([string]$embeddedProvenance.productVersion -ceq $versionId.Substring(1)) "Embedded Otter build provenance has the wrong product version."
Assert-ReleaseCondition ([string]$embeddedProvenance.artifact.name -ceq "otter.exe" -and [int64]$embeddedProvenance.artifact.bytes -eq $zipExeDigest.bytes -and [string]$embeddedProvenance.artifact.sha256 -ceq $zipExeDigest.sha256) "Embedded Otter build provenance does not match packaged otter.exe."

$zipDigest = Get-OtterReleaseDigest -Path $zipPath
$sidecarPath = "$zipPath.sha256"
$expectedSidecar = "$($zipDigest.sha256)  $zipName`n"
Assert-ReleaseCondition ((Read-OtterBoundedText -Path $sidecarPath -MaxBytes 1KB) -ceq $expectedSidecar) "Otter ZIP checksum sidecar is invalid."

$provenancePath = Resolve-OtterReleasePath -RootPath $releaseRoot -RelativePath "provenance\build-provenance.json"
$provenance = Read-OtterBoundedText -Path $provenancePath -MaxBytes 1MB | ConvertFrom-Json
Assert-ReleaseCondition ([string]$provenance.gitHead -ceq [string]$manifest.gitHead -and $provenance.gitDirty -eq $false) "Otter build provenance does not match the manifest."
$subjects = @($provenance.subjects | Where-Object { [string]$_.name -ceq $zipName })
Assert-ReleaseCondition ($subjects.Count -eq 1 -and [string]$subjects[0].sha256 -ceq $zipDigest.sha256 -and [int64]$subjects[0].bytes -eq $zipDigest.bytes) "Otter provenance subject does not match the portable ZIP."
if ($null -ne $compatibilityRecord) {
    $compatibilitySubjects = @($provenance.subjects | Where-Object { [string]$_.name -ceq "extension-compatibility.json" })
    Assert-ReleaseCondition ($compatibilitySubjects.Count -eq 1 -and [string]$compatibilitySubjects[0].sha256 -ceq [string]$compatibilityRecord.sha256 -and [int64]$compatibilitySubjects[0].bytes -eq [int64]$compatibilityRecord.bytes) "Otter provenance does not cover extension compatibility evidence."
}

$cyclone = Read-OtterBoundedText -Path (Join-Path $releaseRoot "sbom\Otter-$versionId.cdx.json") -MaxBytes 16MB | ConvertFrom-Json
$spdx = Read-OtterBoundedText -Path (Join-Path $releaseRoot "sbom\Otter-$versionId.spdx.json") -MaxBytes 16MB | ConvertFrom-Json
Assert-ReleaseCondition ($cyclone.bomFormat -eq "CycloneDX" -and $cyclone.specVersion -eq "1.6" -and $cyclone.metadata.component.version -eq $versionId -and @($cyclone.components).Count -gt 0) "CycloneDX SBOM contract failed."
Assert-ReleaseCondition ($spdx.spdxVersion -eq "SPDX-2.3" -and $spdx.name -eq "Otter-$versionId" -and @($spdx.packages).Count -gt 0) "SPDX SBOM contract failed."
& node (Join-Path $PSScriptRoot "release\sbom-inventory.cjs") verify $repoRoot `
    (Join-Path $releaseRoot "sbom\Otter-$versionId.cdx.json") (Join-Path $releaseRoot "sbom\Otter-$versionId.spdx.json")
Assert-ReleaseCondition ($LASTEXITCODE -eq 0) "SBOM inventory does not match source lockfiles."

if ($RunSmoke) {
    if ([string]::IsNullOrWhiteSpace($SmokeArtifactRoot)) {
        $SmokeArtifactRoot = Join-Path $repoRoot "artifacts\release-smoke\$versionId"
    }
    & (Join-Path $PSScriptRoot "Invoke-OtterNativeCandidateAcceptance.ps1") -OtterExe $portableExe -ExpectedSha256 $portableDigest.sha256 -DurationSeconds 60 -WarmupSeconds 5 -ArtifactRoot $SmokeArtifactRoot
}
if ($RunHeadlessSmoke) {
    if ([string]::IsNullOrWhiteSpace($SmokeArtifactRoot)) {
        $SmokeArtifactRoot = Join-Path $repoRoot "artifacts\release-smoke\$versionId-headless"
    }
    & (Join-Path $PSScriptRoot "Invoke-OtterHeadlessReleaseSmoke.ps1") `
        -OtterExe $portableExe -ExpectedSha256 $portableDigest.sha256 `
        -ExpectedVersion $versionId.Substring(1) -ArtifactRoot $SmokeArtifactRoot
}

[ordered]@{
    schemaVersion = 1; app = "Otter"; versionId = $versionId; packageDir = $releaseRoot
    gitHead = $manifest.gitHead; files = $actualFiles.Count; publishedAssets = $actualPublished
    portableExe = $portableExe; portableSha256 = $portableDigest.sha256
    smoke = ($RunSmoke.IsPresent -or $RunHeadlessSmoke.IsPresent)
    smokeMode = if ($RunSmoke) { "native" } elseif ($RunHeadlessSmoke) { "headless-self-check" } else { "none" }
} | ConvertTo-Json -Depth 10
