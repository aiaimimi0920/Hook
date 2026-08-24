[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PackageDir,
    [switch]$RequireCleanSource,
    [switch]$RunSmoke,
    [string]$SmokeArtifactRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
. (Join-Path $PSScriptRoot "file-hash.ps1")
. (Join-Path $PSScriptRoot "release\PathSafety.ps1")
. (Join-Path $PSScriptRoot "release\Manifest.ps1")

function Assert-ReleaseCondition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function ConvertTo-RecordMap {
    param([object[]]$Records)
    $map = @{}
    foreach ($record in $Records) {
        $path = Assert-HookSafeRelativePath -RelativePath ([string]$record.path)
        Assert-ReleaseCondition (-not $map.ContainsKey($path)) "Duplicate Hook release record: $path"
        $map[$path] = $record
    }
    return $map
}

$releaseRoot = [System.IO.Path]::GetFullPath($PackageDir)
Assert-ReleaseCondition (Test-Path -LiteralPath $releaseRoot -PathType Container) "Hook release directory is missing: $releaseRoot"
Assert-HookNoReparsePoints -RootPath $releaseRoot -Path $releaseRoot
$manifestPath = Join-Path $releaseRoot "manifest.json"
$checksumsPath = Join-Path $releaseRoot "checksums.sha256"
foreach ($path in @($manifestPath, $checksumsPath)) {
    Assert-ReleaseCondition (Test-Path -LiteralPath $path -PathType Leaf) "Hook release metadata is missing: $path"
}

$manifest = Read-HookBoundedText -Path $manifestPath -MaxBytes 4MB | ConvertFrom-Json
Assert-ReleaseCondition ([int]$manifest.schemaVersion -eq 1 -and [string]$manifest.app -eq "Hook") "Unsupported Hook release manifest."
Assert-ReleaseCondition ([string]$manifest.versionId -match '^V\d+\.\d+\.\d+$') "Hook release manifest has an invalid version."
Assert-ReleaseCondition ([string]$manifest.target -eq "windows-x64") "Hook release target must be windows-x64."
Assert-ReleaseCondition ([string]$manifest.gitHead -match '^[0-9a-f]{40}$') "Hook release source commit is invalid."
Assert-ReleaseCondition ($manifest.gitDirty -eq $false -and $manifest.sourceGitDirty -eq $false) "Formal Hook release provenance must record a clean source."

if ($RequireCleanSource) {
    $dirty = @(& git -C $repoRoot status --porcelain --untracked-files=all 2>$null)
    Assert-ReleaseCondition ($LASTEXITCODE -eq 0 -and $dirty.Count -eq 0) "Formal Hook verification requires a clean Git worktree."
    $head = (& git -C $repoRoot rev-parse HEAD).Trim()
    Assert-ReleaseCondition ($LASTEXITCODE -eq 0 -and $head -eq [string]$manifest.gitHead) "Release manifest does not match the current clean source commit."
}

$versionId = [string]$manifest.versionId
$zipName = "hook-windows-x64-$versionId.zip"
$expectedPublished = @(
    "packages\$zipName", "packages\$zipName.sha256",
    "sbom\Hook-$versionId.cdx.json", "sbom\Hook-$versionId.spdx.json",
    "provenance\build-provenance.json", "manifest.json", "checksums.sha256"
)
$actualPublished = @($manifest.publishedAssets | ForEach-Object { Assert-HookSafeRelativePath -RelativePath ([string]$_) } | Sort-Object)
Assert-ReleaseCondition (($actualPublished -join "`n") -ceq (($expectedPublished | Sort-Object) -join "`n")) "Hook published asset set does not match the formal contract."

$recordMap = ConvertTo-RecordMap -Records @($manifest.files)
$actualFiles = @(Get-HookSafeReleaseFiles -RootPath $releaseRoot)
$recordedActual = @($actualFiles | Where-Object { $_.Name -notin @("manifest.json", "checksums.sha256") })
Assert-ReleaseCondition ($recordMap.Count -eq $recordedActual.Count) "Hook release file inventory count does not match the manifest."
foreach ($file in $recordedActual) {
    $relative = Get-HookReleaseRelativePath -RootPath $releaseRoot -Path $file.FullName
    Assert-ReleaseCondition ($recordMap.ContainsKey($relative)) "Unrecorded Hook release file: $relative"
    $digest = Get-HookReleaseDigest -Path $file.FullName
    $record = $recordMap[$relative]
    Assert-ReleaseCondition ([int64]$record.bytes -eq $digest.bytes -and [string]$record.sha256 -ceq $digest.sha256) "Hook release file digest mismatch: $relative"
}

$checksumText = Read-HookBoundedText -Path $checksumsPath -MaxBytes 4MB
$checksumMap = @{}
foreach ($line in @($checksumText -split '\r?\n' | Where-Object { $_.Length -gt 0 })) {
    $match = [regex]::Match($line, '^([0-9a-f]{64})  (.+)$')
    Assert-ReleaseCondition $match.Success "Invalid checksums.sha256 entry."
    $relative = (Assert-HookSafeRelativePath -RelativePath $match.Groups[2].Value).Replace("/", "\")
    Assert-ReleaseCondition (-not $checksumMap.ContainsKey($relative)) "Duplicate checksum entry: $relative"
    $checksumMap[$relative] = $match.Groups[1].Value
}
$hashedFiles = @($actualFiles | Where-Object { $_.FullName -ne $checksumsPath })
Assert-ReleaseCondition ($checksumMap.Count -eq $hashedFiles.Count) "Hook checksum inventory is incomplete."
foreach ($file in $hashedFiles) {
    $relative = Get-HookReleaseRelativePath -RootPath $releaseRoot -Path $file.FullName
    Assert-ReleaseCondition ($checksumMap[$relative] -ceq (Get-HookFileSha256 -Path $file.FullName)) "Hook checksum mismatch: $relative"
}

$zipPath = Resolve-HookReleasePath -RootPath $releaseRoot -RelativePath "packages\$zipName"
$expectedZipEntries = @(
    "build-provenance.json", "hook.exe", "LICENSE.txt", "THIRD_PARTY_NOTICES.md",
    "third-party-licenses\CAP_SCAP_MIT.txt", "third-party-licenses\DRAG_APACHE-2.0.txt",
    "third-party-licenses\DRAG_MIT.txt"
)
$zipEntries = @(Get-HookArchiveEntries -ZipPath $zipPath)
Assert-ReleaseCondition (($zipEntries -join "`n") -ceq (($expectedZipEntries | Sort-Object) -join "`n")) "Hook portable ZIP payload is not exact."
$portableExe = Resolve-HookReleasePath -RootPath $releaseRoot -RelativePath "portable\hook.exe"
$portableDigest = Get-HookReleaseDigest -Path $portableExe
$zipExeDigest = Get-HookArchiveEntryDigest -ZipPath $zipPath -EntryName "hook.exe"
Assert-ReleaseCondition ($portableDigest.bytes -eq $zipExeDigest.bytes -and $portableDigest.sha256 -ceq $zipExeDigest.sha256) "Packaged hook.exe does not match the verified portable executable."
$embeddedProvenance = Read-HookArchiveEntryText -ZipPath $zipPath -EntryName "build-provenance.json" -MaxBytes 1MB | ConvertFrom-Json
Assert-ReleaseCondition ([int]$embeddedProvenance.schemaVersion -eq 1 -and [string]$embeddedProvenance.app -eq "Hook") "Embedded Hook build provenance is unsupported."
Assert-ReleaseCondition ([string]$embeddedProvenance.gitHead -ceq [string]$manifest.gitHead -and $embeddedProvenance.gitDirty -eq $false) "Embedded Hook build provenance does not match the formal source commit."
Assert-ReleaseCondition ([string]$embeddedProvenance.productVersion -ceq $versionId.Substring(1)) "Embedded Hook build provenance has the wrong product version."
Assert-ReleaseCondition ([string]$embeddedProvenance.artifact.name -ceq "hook.exe" -and [int64]$embeddedProvenance.artifact.bytes -eq $zipExeDigest.bytes -and [string]$embeddedProvenance.artifact.sha256 -ceq $zipExeDigest.sha256) "Embedded Hook build provenance does not match packaged hook.exe."

$zipDigest = Get-HookReleaseDigest -Path $zipPath
$sidecarPath = "$zipPath.sha256"
$expectedSidecar = "$($zipDigest.sha256)  $zipName`n"
Assert-ReleaseCondition ((Read-HookBoundedText -Path $sidecarPath -MaxBytes 1KB) -ceq $expectedSidecar) "Hook ZIP checksum sidecar is invalid."

$provenancePath = Resolve-HookReleasePath -RootPath $releaseRoot -RelativePath "provenance\build-provenance.json"
$provenance = Read-HookBoundedText -Path $provenancePath -MaxBytes 1MB | ConvertFrom-Json
Assert-ReleaseCondition ([string]$provenance.gitHead -ceq [string]$manifest.gitHead -and $provenance.gitDirty -eq $false) "Hook build provenance does not match the manifest."
$subjects = @($provenance.subjects | Where-Object { [string]$_.name -ceq $zipName })
Assert-ReleaseCondition ($subjects.Count -eq 1 -and [string]$subjects[0].sha256 -ceq $zipDigest.sha256 -and [int64]$subjects[0].bytes -eq $zipDigest.bytes) "Hook provenance subject does not match the portable ZIP."

$cyclone = Read-HookBoundedText -Path (Join-Path $releaseRoot "sbom\Hook-$versionId.cdx.json") -MaxBytes 16MB | ConvertFrom-Json
$spdx = Read-HookBoundedText -Path (Join-Path $releaseRoot "sbom\Hook-$versionId.spdx.json") -MaxBytes 16MB | ConvertFrom-Json
Assert-ReleaseCondition ($cyclone.bomFormat -eq "CycloneDX" -and $cyclone.specVersion -eq "1.6" -and $cyclone.metadata.component.version -eq $versionId -and @($cyclone.components).Count -gt 0) "CycloneDX SBOM contract failed."
Assert-ReleaseCondition ($spdx.spdxVersion -eq "SPDX-2.3" -and $spdx.name -eq "Hook-$versionId" -and @($spdx.packages).Count -gt 0) "SPDX SBOM contract failed."

if ($RunSmoke) {
    if ([string]::IsNullOrWhiteSpace($SmokeArtifactRoot)) {
        $SmokeArtifactRoot = Join-Path $repoRoot "artifacts\release-smoke\$versionId"
    }
    & (Join-Path $PSScriptRoot "Invoke-HookNativeCandidateAcceptance.ps1") -HookExe $portableExe -ExpectedSha256 $portableDigest.sha256 -DurationSeconds 60 -WarmupSeconds 5 -ArtifactRoot $SmokeArtifactRoot
    if ($LASTEXITCODE -ne 0) { throw "Hook release runtime smoke failed with exit code $LASTEXITCODE." }
}

[ordered]@{
    schemaVersion = 1; app = "Hook"; versionId = $versionId; packageDir = $releaseRoot
    gitHead = $manifest.gitHead; files = $actualFiles.Count; publishedAssets = $actualPublished
    portableExe = $portableExe; portableSha256 = $portableDigest.sha256; smoke = $RunSmoke.IsPresent
} | ConvertTo-Json -Depth 10
