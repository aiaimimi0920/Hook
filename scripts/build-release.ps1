[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^V\d+\.\d+\.\d+$')][string]$VersionId,
    [string]$OutputRoot = "..\release\Hook",
    [string]$ExtensionCompatibilityPath = "",
    [string]$PreparedPortableDir = "",
    [switch]$RequireCleanSource,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
. (Join-Path $PSScriptRoot "file-hash.ps1")
. (Join-Path $PSScriptRoot "release\PathSafety.ps1")
. (Join-Path $PSScriptRoot "release\Manifest.ps1")
. (Join-Path $PSScriptRoot "release\ExtensionCompatibility.ps1")

function Get-HookGitText {
    param([string[]]$Arguments)
    $output = @(& git -C $repoRoot @Arguments 2>$null)
    if ($LASTEXITCODE -ne 0) { return "" }
    return (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
}
function Get-HookSourceDirty {
    $output = @(& git -C $repoRoot status --porcelain --untracked-files=all 2>$null)
    if ($LASTEXITCODE -ne 0) { return $null }
    return [bool](@($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -gt 0)
}

$resolvedOutputRoot = if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
    [System.IO.Path]::GetFullPath($OutputRoot)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputRoot))
}
$destination = Resolve-HookReleasePath -RootPath $resolvedOutputRoot -RelativePath $VersionId
$sourceDirty = Get-HookSourceDirty
if ($RequireCleanSource -and $sourceDirty -ne $false) {
    throw "Formal Hook release requires a clean, readable Git worktree. gitDirty=$sourceDirty"
}

$productVersion = [string]((Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot "package.json") | ConvertFrom-Json).version)
if ($VersionId -ne "V$productVersion") {
    throw "Release ID $VersionId does not match Hook product version $productVersion."
}
& (Join-Path $PSScriptRoot "assert-release-version.ps1")
if ($LASTEXITCODE -ne 0) { throw "Hook version preflight failed with exit code $LASTEXITCODE." }

if ($DryRun) {
    [ordered]@{
        schemaVersion = 1; app = "Hook"; versionId = $VersionId
        outputRoot = $resolvedOutputRoot; destination = $destination
        sourceGitDirty = $sourceDirty; requireCleanSource = $RequireCleanSource.IsPresent
        preparedPortable = -not [string]::IsNullOrWhiteSpace($PreparedPortableDir)
    } | ConvertTo-Json
    exit 0
}
if (Test-Path -LiteralPath $destination) {
    throw "Formal Hook release destination already exists: $destination"
}

New-Item -ItemType Directory -Force -Path $resolvedOutputRoot | Out-Null
Assert-HookNoReparsePoints -RootPath $resolvedOutputRoot -Path $resolvedOutputRoot
New-Item -ItemType Directory -Path $destination | Out-Null
Assert-HookNoReparsePoints -RootPath $resolvedOutputRoot -Path $destination

$portableDir = Resolve-HookReleasePath -RootPath $destination -RelativePath "portable"
$packageDir = Resolve-HookReleasePath -RootPath $destination -RelativePath "packages"
$sbomDir = Resolve-HookReleasePath -RootPath $destination -RelativePath "sbom"
$provenanceDir = Resolve-HookReleasePath -RootPath $destination -RelativePath "provenance"
$compatibilityDir = Resolve-HookReleasePath -RootPath $destination -RelativePath "compatibility"
foreach ($directory in @($portableDir, $packageDir, $sbomDir, $provenanceDir, $compatibilityDir)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
}

$portableExe = Join-Path $portableDir "hook.exe"
$portableProvenance = Join-Path $portableDir "build-provenance.json"
$preparedMode = -not [string]::IsNullOrWhiteSpace($PreparedPortableDir)
if ($preparedMode) {
    $preparedRoot = [System.IO.Path]::GetFullPath($PreparedPortableDir)
    if (-not (Test-Path -LiteralPath $preparedRoot -PathType Container)) {
        throw "Prepared Hook portable directory is missing: $preparedRoot"
    }
    foreach ($name in @("hook.exe", "build-provenance.json")) {
        $source = Join-Path $preparedRoot $name
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Prepared Hook portable payload is missing $name."
        }
        [void](Assert-HookAbsolutePathNoReparsePoints -Path $source -TrustedRootPath $preparedRoot)
        Copy-Item -LiteralPath $source -Destination (Join-Path $portableDir $name)
    }
} else {
    & (Join-Path $PSScriptRoot "build-local-hook-exe.ps1") `
        -OutputDir $portableDir `
        -RequireCleanSource:$RequireCleanSource.IsPresent `
        -Force
}
$gitHead = Get-HookGitText -Arguments @("rev-parse", "HEAD")
if ($gitHead -notmatch '^[0-9a-f]{40}$') { throw "Cannot resolve the Hook source commit for provenance." }
if ($preparedMode) {
    $preparedProvenance = Read-HookBoundedText -Path $portableProvenance -MaxBytes 1MB | ConvertFrom-Json
    if ([string]$preparedProvenance.app -cne "Hook" -or
        [string]$preparedProvenance.gitHead -cne $gitHead) {
        throw "Prepared Hook provenance does not match the Hook source commit."
    }
    if ($null -eq $sourceDirty -or [bool]$preparedProvenance.gitDirty -ne [bool]$sourceDirty) {
        throw "Prepared Hook provenance does not match the current worktree state."
    }
    if ($RequireCleanSource -and [bool]$preparedProvenance.gitDirty -ne $false) {
        throw "Prepared Hook provenance is not clean."
    }
    $preparedDigest = Get-HookReleaseDigest -Path $portableExe
    if ([string]$preparedProvenance.artifact.name -cne "hook.exe" -or
        [int64]$preparedProvenance.artifact.bytes -ne [int64]$preparedDigest.bytes -or
        [string]$preparedProvenance.artifact.sha256 -cne [string]$preparedDigest.sha256) {
        throw "Prepared Hook executable does not match its provenance artifact record."
    }
}
$compatibilityRecord = $null
$packagingCompatibilityPath = ""
if (-not [string]::IsNullOrWhiteSpace($ExtensionCompatibilityPath)) {
    $compatibility = Read-HookExtensionCompatibility -Path $ExtensionCompatibilityPath
    Assert-HookExtensionCompatibility -Document $compatibility -GitHead $gitHead -ExecutablePath $portableExe
    $packagingCompatibilityPath = Join-Path $compatibilityDir "extension-compatibility.json"
    Copy-Item -LiteralPath ([System.IO.Path]::GetFullPath($ExtensionCompatibilityPath)) -Destination $packagingCompatibilityPath -Force
    $compatibilityRecord = New-HookFileRecord -RootPath $destination -Path $packagingCompatibilityPath -Kind "compatibility"
}
& (Join-Path $PSScriptRoot "package-release-zip.ps1") `
    -ExePath $portableExe -OutputDir $packageDir -Tag $VersionId `
    -ExtensionCompatibilityPath $packagingCompatibilityPath -Force
$zipName = "hook-windows-x64-$VersionId.zip"
$zipPath = Join-Path $packageDir $zipName
$zipDigest = Get-HookReleaseDigest -Path $zipPath
$sidecarPath = "$zipPath.sha256"
Write-HookUtf8NoBom -Path $sidecarPath -Value "$($zipDigest.sha256)  $zipName`n"

& (Join-Path $PSScriptRoot "New-HookSbom.ps1") -OutputDirectory $sbomDir -Version $VersionId | Out-Null
$provenanceSubjects = @([ordered]@{ name = $zipName; bytes = $zipDigest.bytes; sha256 = $zipDigest.sha256 })
if ($null -ne $compatibilityRecord) {
    $provenanceSubjects += [ordered]@{
        name = "extension-compatibility.json"
        bytes = $compatibilityRecord.bytes
        sha256 = $compatibilityRecord.sha256
    }
}
$formalProvenancePath = Join-Path $provenanceDir "build-provenance.json"
$formalProvenance = [ordered]@{
    schemaVersion = 1
    builder = "Hook scripts/build-release.ps1"
    versionId = $VersionId
    target = "windows-x64"
    builtAt = [DateTimeOffset]::UtcNow.ToString("o")
    gitHead = $gitHead
    gitDirty = $sourceDirty
    sourcePaths = @(".")
    commands = @(
        $(if ($preparedMode) { "reuse verified prepared Hook portable payload" } else { "npm run tauri build -- --no-bundle" }),
        "scripts/package-release-zip.ps1",
        "scripts/New-HookSbom.ps1"
    )
    subjects = $provenanceSubjects
}
Write-HookUtf8NoBom -Path $formalProvenancePath -Value (($formalProvenance | ConvertTo-Json -Depth 10) + "`n")

$files = @(Get-HookSafeReleaseFiles -RootPath $destination | Sort-Object FullName | ForEach-Object {
    $relative = Get-HookReleaseRelativePath -RootPath $destination -Path $_.FullName
    $kind = if ($relative -like "packages\*") { "package" } elseif ($relative -like "sbom\*") { "sbom" } elseif ($relative -like "provenance\*") { "provenance" } else { "portable-payload" }
    New-HookFileRecord -RootPath $destination -Path $_.FullName -Kind $kind
})
$publishedAssets = @(
    "packages\$zipName",
    "packages\$zipName.sha256",
    "sbom\Hook-$VersionId.cdx.json",
    "sbom\Hook-$VersionId.spdx.json",
    "provenance\build-provenance.json",
    "manifest.json",
    "checksums.sha256"
)
$manifest = [ordered]@{
    schemaVersion = 1; app = "Hook"; sourceProject = "Hook"; versionId = $VersionId
    builtAt = [DateTimeOffset]::UtcNow.ToString("o"); target = "windows-x64"
    gitHead = $gitHead; gitDirty = $sourceDirty; sourceGitDirty = $sourceDirty
    sourcePaths = @("."); files = $files; publishedAssets = $publishedAssets
    extensionCompatibility = $compatibilityRecord
}
$manifestPath = Join-Path $destination "manifest.json"
Write-HookUtf8NoBom -Path $manifestPath -Value (($manifest | ConvertTo-Json -Depth 15) + "`n")
$checksumsPath = Write-HookReleaseChecksums -ReleaseRoot $destination

[ordered]@{
    schemaVersion = 1; app = "Hook"; versionId = $VersionId; destination = $destination
    portableExe = $portableExe; package = $zipPath; manifest = $manifestPath; checksums = $checksumsPath
    publishedAssets = $publishedAssets
} | ConvertTo-Json -Depth 10
