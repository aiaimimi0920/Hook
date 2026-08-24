[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$HookExe,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][string]$ArtifactRoot,
    [ValidateRange(5, 120)][int]$TimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot "file-hash.ps1")
. (Join-Path $scriptRoot "release\PathSafety.ps1")
. (Join-Path $scriptRoot "release\Manifest.ps1")

$resolvedExe = [IO.Path]::GetFullPath($HookExe)
$resolvedArtifactRoot = [IO.Path]::GetFullPath($ArtifactRoot)
if (-not (Test-Path -LiteralPath $resolvedExe -PathType Leaf)) {
    throw "Headless Hook smoke executable is missing: $resolvedExe"
}
$resolvedExe = Assert-HookAbsolutePathNoReparsePoints `
    -Path $resolvedExe -TrustedRootPath (Split-Path -Parent $resolvedExe)
$exe = Get-Item -LiteralPath $resolvedExe
if ($exe.Length -le 0 -or $exe.Length -gt 512MB) {
    throw "Headless Hook smoke executable has an invalid size: $($exe.Length) bytes"
}
$actualSha256 = Get-HookFileSha256 -Path $resolvedExe
if ($actualSha256 -cne $ExpectedSha256.ToLowerInvariant()) {
    throw "Headless Hook smoke executable digest mismatch."
}

$artifactTrustedRoot = Split-Path -Parent $resolvedArtifactRoot
while (-not (Test-Path -LiteralPath $artifactTrustedRoot -PathType Container)) {
    $parent = Split-Path -Parent $artifactTrustedRoot
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $artifactTrustedRoot) {
        throw "Headless Hook smoke evidence has no existing trusted ancestor: $resolvedArtifactRoot"
    }
    $artifactTrustedRoot = $parent
}
Assert-HookAbsolutePathNoReparsePoints `
    -Path $resolvedArtifactRoot -TrustedRootPath $artifactTrustedRoot | Out-Null
if (-not (Test-Path -LiteralPath $resolvedArtifactRoot)) {
    New-Item -ItemType Directory -Path $resolvedArtifactRoot | Out-Null
}
Assert-HookAbsolutePathNoReparsePoints `
    -Path $resolvedArtifactRoot -TrustedRootPath $artifactTrustedRoot | Out-Null
$selfCheckPath = Join-Path $resolvedArtifactRoot "self-check.json"
$summaryPath = Join-Path $resolvedArtifactRoot "headless-summary.json"
if ((Test-Path -LiteralPath $selfCheckPath) -or (Test-Path -LiteralPath $summaryPath)) {
    throw "Headless Hook smoke evidence already exists: $resolvedArtifactRoot"
}

$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $resolvedExe
$startInfo.Arguments = "--self-check"
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.EnvironmentVariables["HOOK_SELF_CHECK_OUTPUT"] = $selfCheckPath
$process = [Diagnostics.Process]::new()
$process.StartInfo = $startInfo
try {
    if (-not $process.Start()) { throw "Headless Hook self-check did not start." }
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        try {
            $process.Kill()
            if (-not $process.WaitForExit(5000)) {
                throw "Timed-out Hook self-check did not exit after termination."
            }
        } catch {
            throw "Unable to terminate timed-out Hook self-check: $($_.Exception.Message)"
        }
        throw "Headless Hook self-check timed out after $TimeoutSeconds seconds."
    }
    $exitCode = $process.ExitCode
} finally {
    $process.Dispose()
}
if ($exitCode -ne 0) { throw "Headless Hook self-check exited with code $exitCode." }
if (-not (Test-Path -LiteralPath $selfCheckPath -PathType Leaf)) {
    throw "Headless Hook self-check did not write its report."
}
Assert-HookAbsolutePathNoReparsePoints `
    -Path $selfCheckPath -TrustedRootPath $artifactTrustedRoot | Out-Null

$report = Read-HookBoundedText -Path $selfCheckPath -MaxBytes 1MB | ConvertFrom-Json
if ([string]$report.app -cne "Hook" -or [string]$report.binary -cne "hook.exe" -or
    [string]$report.version -cne $ExpectedVersion -or [string]$report.status -cne "ok") {
    throw "Headless Hook self-check identity or version contract failed."
}
$requiredCapabilities = @("desktop", "capture", "loomConnector", "talkConnector", "teaConnector", "voice")
foreach ($name in $requiredCapabilities) {
    $property = $report.capabilities.PSObject.Properties[$name]
    if ($null -eq $property -or $property.Value -ne $true) {
        throw "Headless Hook self-check capability failed: $name"
    }
}

$summary = [ordered]@{
    schemaVersion = 1; app = "Hook"; status = "passed"; mode = "headless-self-check"
    executable = [ordered]@{ path = $resolvedExe; bytes = [int64]$exe.Length; sha256 = $actualSha256 }
    expectedVersion = $ExpectedVersion; capabilities = $requiredCapabilities
}
Write-HookUtf8NoBom -Path $summaryPath -Value (($summary | ConvertTo-Json -Depth 8) + "`n")
Assert-HookAbsolutePathNoReparsePoints `
    -Path $summaryPath -TrustedRootPath $artifactTrustedRoot | Out-Null
Write-Output "[hook-headless-release-smoke] Passed: $summaryPath"
