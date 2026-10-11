[CmdletBinding()]
param(
    [string]$OutputDir = "..\release\Otter",
    [switch]$Force,
    [switch]$DryRun,
    [switch]$UiAccess,
    [switch]$AllowUnsignedUiAccessBuild,
    [switch]$RequireCleanSource,
    [switch]$PublicRelease
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$otterRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$outputRoot = if ([System.IO.Path]::IsPathRooted($OutputDir)) {
    [System.IO.Path]::GetFullPath($OutputDir)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $otterRoot $OutputDir))
}
$releaseExe = Join-Path $otterRoot "src-tauri\target\release\otter.exe"
# Renamed checkouts may need a fresh target directory because Tauri caches absolute paths.
if (-not [string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
    if (-not [System.IO.Path]::IsPathRooted($env:CARGO_TARGET_DIR)) {
        throw "CARGO_TARGET_DIR must be absolute for release packaging."
    }
    $releaseExe = Join-Path ([System.IO.Path]::GetFullPath($env:CARGO_TARGET_DIR)) "release\otter.exe"
}
$versionPreflightScript = Join-Path $otterRoot "scripts\assert-release-version.ps1"
$fileHashScript = Join-Path $otterRoot "scripts\file-hash.ps1"
. $fileHashScript
. (Join-Path $PSScriptRoot "version-identity.ps1")
. (Join-Path $PSScriptRoot "Write-OtterLoomLauncher.ps1")
$versionIdentity = Get-OtterVersionIdentity -RepoRoot $otterRoot -PublicRelease:$PublicRelease.IsPresent

function Get-OtterGitText {
    param([string[]]$Arguments)

    try {
        $output = @(& git -C $otterRoot @Arguments 2>$null)
        if ($LASTEXITCODE -eq 0) {
            return (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
        }
    }
    catch {
        return ""
    }
    return ""
}

function Get-OtterGitDirty {
    try {
        $output = @(& git -C $otterRoot status --porcelain --untracked-files=all 2>$null)
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        return (@($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_.ToString()) }).Count -gt 0)
    }
    catch {
        return $null
    }
}

function Write-OtterBuildProvenance {
    param(
        [string]$PublishedExe,
        [AllowNull()][object]$GitDirty
    )

    $gitHead = Get-OtterGitText -Arguments @("rev-parse", "HEAD")
    if ([string]::IsNullOrWhiteSpace($gitHead)) {
        $gitHead = "unknown"
    }
    $productVersion = [string]((Get-Content -LiteralPath (Join-Path $otterRoot "package.json") -Raw | ConvertFrom-Json).version)
    $artifact = Get-Item -LiteralPath $PublishedExe
    $manifest = [ordered]@{
        schemaVersion = 1
        app = "Otter"
        builder = "Otter scripts/build-local-otter-exe.ps1"
        builtAt = (Get-Date).ToString("o")
        productVersion = $productVersion
        buildVersion = $versionIdentity.buildVersion
        channel = $versionIdentity.channel
        internalRevision = $versionIdentity.internalRevision
        gitHead = $gitHead
        gitDirty = $GitDirty
        sourcePaths = @(".")
        uiAccess = $UiAccess.IsPresent
        artifact = [ordered]@{
            name = $artifact.Name
            bytes = [int64]$artifact.Length
            sha256 = Get-OtterFileSha256 -Path $artifact.FullName
        }
    }
    $manifestPath = Join-Path $outputRoot "build-provenance.json"
    $json = ($manifest | ConvertTo-Json -Depth 10) + "`n"
    [System.IO.File]::WriteAllText($manifestPath, $json, [System.Text.UTF8Encoding]::new($false))
    return $manifestPath
}

function Ensure-OutputDirectory {
    param(
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path
        if (-not $item.PSIsContainer) {
            throw "Output path exists but is not a directory: $Path"
        }
        return
    }

    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Get-TimestampedOtterExePath {
    param(
        [string]$OutputRoot
    )

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $candidate = Join-Path $OutputRoot "otter-$timestamp.exe"
    $counter = 1

    while (Test-Path -LiteralPath $candidate) {
        $candidate = Join-Path $OutputRoot "otter-$timestamp-$counter.exe"
        $counter++
    }

    return $candidate
}

$sourceGitDirty = Get-OtterGitDirty
if ($RequireCleanSource -and $sourceGitDirty -ne $false) {
    throw "Formal Otter release requires a clean, readable Git worktree. gitDirty=$sourceGitDirty"
}

if ($DryRun) {
    $buildCommand = if ($UiAccess) {
        "set HOOK_WINDOWS_UIACCESS=1 && npm run tauri build -- --no-bundle"
    } else {
        "npm run tauri build -- --no-bundle"
    }
    [ordered]@{
        otterRoot = $otterRoot
        outputDir = $outputRoot
        releaseExe = $releaseExe
        primaryOutputExe = (Join-Path $outputRoot "otter.exe")
        fallbackOutputExeExample = (Join-Path $outputRoot "otter-YYYYMMDD-HHMMSS.exe")
        buildCommand = $buildCommand
        uiAccess = $UiAccess.IsPresent
        allowUnsignedUiAccessBuild = $AllowUnsignedUiAccessBuild.IsPresent
        requireCleanSource = $RequireCleanSource.IsPresent
        sourceGitDirty = $sourceGitDirty
        buildVersion = $versionIdentity.buildVersion
        channel = $versionIdentity.channel
    } | ConvertTo-Json -Depth 5
    exit 0
}

if ($UiAccess -and -not $AllowUnsignedUiAccessBuild) {
    throw "Refusing to build an unsigned uiAccess exe by default. Windows will reject it at launch with 'A referral was returned from the server'. Re-run with -AllowUnsignedUiAccessBuild only if you are about to digitally sign it and install it into a trusted location such as Program Files."
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $versionPreflightScript
if ($LASTEXITCODE -ne 0) {
    throw "Otter version preflight failed with exit code $LASTEXITCODE."
}

Ensure-OutputDirectory -Path $outputRoot

Push-Location -LiteralPath $otterRoot
try {
    $buildCommand = if ($UiAccess) {
        'set "HOOK_WINDOWS_UIACCESS=1" && npm run tauri build -- --no-bundle'
    } else {
        "npm run tauri build -- --no-bundle"
    }
    # Tauri writes informational progress to stderr. Windows PowerShell can turn
    # those lines into NativeCommandError records when the script is fail-fast,
    # so use the native exit code as the authoritative build result.
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        & cmd.exe /d /c $buildCommand
        $buildExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($buildExitCode -ne 0) {
        throw "Otter Tauri build failed with exit code $buildExitCode."
    }
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $releaseExe -PathType Leaf)) {
    throw "Expected built executable is missing: $releaseExe"
}

$preferredExe = Join-Path $outputRoot "otter.exe"
$publishedExe = $preferredExe

try {
    if ($Force -and (Test-Path -LiteralPath $preferredExe -PathType Leaf)) {
        Remove-Item -LiteralPath $preferredExe -Force -ErrorAction Stop
    }

    Copy-Item -LiteralPath $releaseExe -Destination $preferredExe -Force -ErrorAction Stop
}
catch {
    $fallbackExe = Join-Path $outputRoot (Split-Path -Leaf (Get-TimestampedOtterExePath -OutputRoot $outputRoot))
    Write-Warning "Primary release exe could not be replaced; existing otter.exe is locked or otherwise unavailable. Writing timestamped fallback instead: $fallbackExe"
    Copy-Item -LiteralPath $releaseExe -Destination $fallbackExe -Force -ErrorAction Stop
    $publishedExe = $fallbackExe
}

$provenancePath = Write-OtterBuildProvenance -PublishedExe $publishedExe -GitDirty $sourceGitDirty
$loomLauncher = Write-OtterLoomLauncher -OtterExe $publishedExe
Write-Host "[otter-local-build] Built exe:"
Write-Host "  $publishedExe"
Write-Host "[otter-local-build] Provenance:"
Write-Host "  $provenancePath"
Write-Host "[otter-local-build] Explicit Loom integration launcher:"
Write-Host "  $loomLauncher"
if ($UiAccess) {
    Write-Warning "This build embeds a uiAccess manifest, but Windows only honors uiAccess when the binary is digitally signed and installed in a trusted location such as Program Files."
}
