[CmdletBinding()]
param(
    [string]$OutputDir = "..\release\Hook",
    [switch]$Force,
    [switch]$DryRun,
    [switch]$UiAccess,
    [switch]$AllowUnsignedUiAccessBuild
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
    } | ConvertTo-Json -Depth 5
    exit 0
}

if ($UiAccess -and -not $AllowUnsignedUiAccessBuild) {
    throw "Refusing to build an unsigned uiAccess exe by default. Windows will reject it at launch with 'A referral was returned from the server'. Re-run with -AllowUnsignedUiAccessBuild only if you are about to digitally sign it and install it into a trusted location such as Program Files."
}

Ensure-OutputDirectory -Path $outputRoot

Push-Location -LiteralPath $hookRoot
try {
    $buildCommand = if ($UiAccess) {
        'set "HOOK_WINDOWS_UIACCESS=1" && npm run tauri build -- --no-bundle'
    } else {
        "npm run tauri build -- --no-bundle"
    }
    & cmd.exe /d /c $buildCommand
    if ($LASTEXITCODE -ne 0) {
        throw "Hook Tauri build failed with exit code $LASTEXITCODE."
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

Write-Host "[hook-local-build] Built exe:"
Write-Host "  $publishedExe"
if ($UiAccess) {
    Write-Warning "This build embeds a uiAccess manifest, but Windows only honors uiAccess when the binary is digitally signed and installed in a trusted location such as Program Files."
}
