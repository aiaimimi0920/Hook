[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $repoRoot "scripts\capture-homepage-assets\session-fixture.ps1")

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Message)
    try {
        & $Action
    } catch {
        return
    }
    throw $Message
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("hook-homepage-fixture-test-" + [Guid]::NewGuid().ToString("N"))
[System.IO.Directory]::CreateDirectory($tempRoot) | Out-Null
try {
    $pngBytes = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
    $paths = @("capture.png", "sticker.png", "workflow.png") | ForEach-Object {
        $path = Join-Path $tempRoot $_
        [System.IO.File]::WriteAllBytes($path, $pngBytes)
        $path
    }

    $session = New-HomepageSessionJson -CaptureCardPath $paths[0] -StickerCardPath $paths[1] -WorkflowCardPath $paths[2] | ConvertFrom-Json
    Assert-True ($session.stickers.Count -eq 5) "Homepage fixture must contain five stickers."
    foreach ($sticker in $session.stickers) {
        Assert-True ([string]$sticker.src).StartsWith("data:image/png;base64,") "Fixture images must use embedded PNG data URLs."
        Assert-True (-not ([string]$sticker.src).Contains($tempRoot)) "Fixture JSON leaked a host file path."
    }

    $invalidPath = Join-Path $tempRoot "invalid.png"
    [System.IO.File]::WriteAllBytes($invalidPath, [byte[]](0, 1, 2, 3, 4, 5, 6, 7))
    Assert-Throws {
        New-HomepageSessionJson -CaptureCardPath $invalidPath -StickerCardPath $paths[1] -WorkflowCardPath $paths[2] | Out-Null
    } "Invalid PNG signatures must be rejected."

    $oversizePath = Join-Path $tempRoot "oversize.png"
    $stream = [System.IO.File]::Open($oversizePath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $stream.SetLength(8MB + 1) } finally { $stream.Dispose() }
    Assert-Throws {
        New-HomepageSessionJson -CaptureCardPath $oversizePath -StickerCardPath $paths[1] -WorkflowCardPath $paths[2] | Out-Null
    } "Oversized fixture images must be rejected."

    Write-Output "Hook homepage session fixture contract passed: embedded=5 max-card-bytes=$((8MB))"
} finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
