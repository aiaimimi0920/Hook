[CmdletBinding()]
param(
    [string]$OutputDir = "..\release\Hook",
    [switch]$Force,
    [switch]$DryRun,
    [switch]$UiAccess,
    [switch]$AllowUnsignedUiAccessBuild,
    [switch]$RequireCleanSource,
    [switch]$PublicRelease
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$hookRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$outputRoot = if ([System.IO.Path]::IsPathRooted($OutputDir)) {
    [System.IO.Path]::GetFullPath($OutputDir)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $hookRoot $OutputDir))
}
$releaseExe = Join-Path $hookRoot "src-tauri\target\release\hook.exe"
$versionPreflightScript = Join-Path $hookRoot "scripts\assert-release-version.ps1"
$fileHashScript = Join-Path $hookRoot "scripts\file-hash.ps1"
. $fileHashScript
. (Join-Path $PSScriptRoot "version-identity.ps1")
$versionIdentity = Get-HookVersionIdentity -RepoRoot $hookRoot -PublicRelease:$PublicRelease.IsPresent

function Get-HookGitText {
    param([string[]]$Arguments)

    try {
        $output = @(& git -C $hookRoot @Arguments 2>$null)
        if ($LASTEXITCODE -eq 0) {
            return (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
        }
    }
    catch {
        return ""
    }
    return ""
}

function Get-HookGitDirty {
    try {
        $output = @(& git -C $hookRoot status --porcelain --untracked-files=all 2>$null)
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        return (@($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_.ToString()) }).Count -gt 0)
    }
    catch {
        return $null
    }
}

function Write-HookBuildProvenance {
    param(
        [string]$PublishedExe,
        [AllowNull()][object]$GitDirty
    )

    $gitHead = Get-HookGitText -Arguments @("rev-parse", "HEAD")
    if ([string]::IsNullOrWhiteSpace($gitHead)) {
        $gitHead = "unknown"
    }
    $productVersion = [string]((Get-Content -LiteralPath (Join-Path $hookRoot "package.json") -Raw | ConvertFrom-Json).version)
    $artifact = Get-Item -LiteralPath $PublishedExe
    $manifest = [ordered]@{
        schemaVersion = 1
        app = "Hook"
        builder = "Hook scripts/build-local-hook-exe.ps1"
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
            sha256 = Get-HookFileSha256 -Path $artifact.FullName
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

function Get-TimestampedHookExePath {
    param(
        [string]$OutputRoot
    )

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $candidate = Join-Path $OutputRoot "hook-$timestamp.exe"
    $counter = 1

    while (Test-Path -LiteralPath $candidate) {
        $candidate = Join-Path $OutputRoot "hook-$timestamp-$counter.exe"
        $counter++
    }

    return $candidate
}

$sourceGitDirty = Get-HookGitDirty
if ($RequireCleanSource -and $sourceGitDirty -ne $false) {
    throw "Formal Hook release requires a clean, readable Git worktree. gitDirty=$sourceGitDirty"
}

if ($DryRun) {
    $buildCommand = if ($UiAccess) {
        "set HOOK_WINDOWS_UIACCESS=1 && npm run tauri build -- --no-bundle"
    } else {
        "npm run tauri build -- --no-bundle"
    }
    [ordered]@{
        hookRoot = $hookRoot
        outputDir = $outputRoot
        releaseExe = $releaseExe
        primaryOutputExe = (Join-Path $outputRoot "hook.exe")
        fallbackOutputExeExample = (Join-Path $outputRoot "hook-YYYYMMDD-HHMMSS.exe")
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
    throw "Hook version preflight failed with exit code $LASTEXITCODE."
}

Ensure-OutputDirectory -Path $outputRoot

Push-Location -LiteralPath $hookRoot
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
        throw "Hook Tauri build failed with exit code $buildExitCode."
    }
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $releaseExe -PathType Leaf)) {
    throw "Expected built executable is missing: $releaseExe"
}

$preferredExe = Join-Path $outputRoot "hook.exe"
$publishedExe = $preferredExe

try {
    if ($Force -and (Test-Path -LiteralPath $preferredExe -PathType Leaf)) {
        Remove-Item -LiteralPath $preferredExe -Force -ErrorAction Stop
    }

    Copy-Item -LiteralPath $releaseExe -Destination $preferredExe -Force -ErrorAction Stop
}
catch {
    $fallbackExe = Join-Path $outputRoot (Split-Path -Leaf (Get-TimestampedHookExePath -OutputRoot $outputRoot))
    Write-Warning "Primary release exe could not be replaced; existing hook.exe is locked or otherwise unavailable. Writing timestamped fallback instead: $fallbackExe"
    Copy-Item -LiteralPath $releaseExe -Destination $fallbackExe -Force -ErrorAction Stop
    $publishedExe = $fallbackExe
}

$provenancePath = Write-HookBuildProvenance -PublishedExe $publishedExe -GitDirty $sourceGitDirty
Write-Host "[hook-local-build] Built exe:"
Write-Host "  $publishedExe"
Write-Host "[hook-local-build] Provenance:"
Write-Host "  $provenancePath"
if ($UiAccess) {
    Write-Warning "This build embeds a uiAccess manifest, but Windows only honors uiAccess when the binary is digitally signed and installed in a trusted location such as Program Files."
}
