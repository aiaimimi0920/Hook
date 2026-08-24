[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^V\d+\.\d+\.\d+$')][string]$VersionId,
    [string]$OutputRoot = "..\release\Hook",
    [switch]$RequireCleanSource,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
. (Join-Path $PSScriptRoot "file-hash.ps1")
. (Join-Path $PSScriptRoot "release\PathSafety.ps1")
. (Join-Path $PSScriptRoot "release\Manifest.ps1")

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
foreach ($directory in @($portableDir, $packageDir, $sbomDir, $provenanceDir)) {
    New-Item -ItemType Directory -Path $directory | Out-Null
}

& (Join-Path $PSScriptRoot "build-local-hook-exe.ps1") -OutputDir $portableDir -RequireCleanSource -Force
$portableExe = Join-Path $portableDir "hook.exe"
& (Join-Path $PSScriptRoot "package-release-zip.ps1") -ExePath $portableExe -OutputDir $packageDir -Tag $VersionId -Force
$zipName = "hook-windows-x64-$VersionId.zip"
$zipPath = Join-Path $packageDir $zipName
$zipDigest = Get-HookReleaseDigest -Path $zipPath
$sidecarPath = "$zipPath.sha256"
Write-HookUtf8NoBom -Path $sidecarPath -Value "$($zipDigest.sha256)  $zipName`n"

& (Join-Path $PSScriptRoot "New-HookSbom.ps1") -OutputDirectory $sbomDir -Version $VersionId | Out-Null
$gitHead = Get-HookGitText -Arguments @("rev-parse", "HEAD")
if ($gitHead -notmatch '^[0-9a-f]{40}$') { throw "Cannot resolve the Hook source commit for provenance." }

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
        "npm run tauri build -- --no-bundle",
        "scripts/package-release-zip.ps1",
        "scripts/New-HookSbom.ps1"
    )
    subjects = @([ordered]@{ name = $zipName; bytes = $zipDigest.bytes; sha256 = $zipDigest.sha256 })
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
}
$manifestPath = Join-Path $destination "manifest.json"
Write-HookUtf8NoBom -Path $manifestPath -Value (($manifest | ConvertTo-Json -Depth 15) + "`n")
$checksumsPath = Write-HookReleaseChecksums -ReleaseRoot $destination

[ordered]@{
    schemaVersion = 1; app = "Hook"; versionId = $VersionId; destination = $destination
    portableExe = $portableExe; package = $zipPath; manifest = $manifestPath; checksums = $checksumsPath
    publishedAssets = $publishedAssets
} | ConvertTo-Json -Depth 10
