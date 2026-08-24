# Deterministic canvas fixture used only by the desktop homepage capture.

function Get-HomepageCardDataUrl {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
        throw "Homepage capture card is missing: $resolvedPath"
    }
    $file = Get-Item -LiteralPath $resolvedPath -Force
    if (($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Homepage capture cards cannot be reparse points: $resolvedPath"
    }
    if ($file.Length -lt 8 -or $file.Length -gt 8MB) {
        throw "Homepage capture card must be a PNG between 8 bytes and 8 MiB: $resolvedPath"
    }

    $bytes = [System.IO.File]::ReadAllBytes($resolvedPath)
    $pngSignature = [byte[]](137, 80, 78, 71, 13, 10, 26, 10)
    for ($index = 0; $index -lt $pngSignature.Length; $index++) {
        if ($bytes[$index] -ne $pngSignature[$index]) {
            throw "Homepage capture card has an invalid PNG signature: $resolvedPath"
        }
    }

    # Capture fixtures use self-contained URLs instead of widening Tauri's asset scope.
    return "data:image/png;base64,$([Convert]::ToBase64String($bytes))"
}

function New-HomepageSessionJson {
    param(
        [string]$CaptureCardPath,
        [string]$StickerCardPath,
        [string]$WorkflowCardPath
    )
    $captureCardUrl = Get-HomepageCardDataUrl -Path $CaptureCardPath
    $stickerCardUrl = Get-HomepageCardDataUrl -Path $StickerCardPath
    $workflowCardUrl = Get-HomepageCardDataUrl -Path $WorkflowCardPath

    return @{
        stickers = @(
            @{
                id = "desk-1"
                type = "sticker"
                src = $captureCardUrl
                x = 40
                y = 40
                w = 360
                h = 225
                minified = $false
                opacityNormal = 1
                opacityMini = 0.92
                params = @{}
            },
            @{
                id = "desk-2"
                type = "sticker"
                src = $stickerCardUrl
                x = 470
                y = 80
                w = 360
                h = 225
                minified = $false
                opacityNormal = 1
                opacityMini = 0.92
                params = @{}
            },
            @{
                id = "desk-3"
                type = "sticker"
                src = $workflowCardUrl
                x = 870
                y = 120
                w = 360
                h = 225
                minified = $false
                opacityNormal = 1
                opacityMini = 0.92
                params = @{}
            },
            @{
                id = "desk-4"
                type = "sticker"
                src = $stickerCardUrl
                x = 220
                y = 350
                w = 360
                h = 225
                minified = $false
                opacityNormal = 1
                opacityMini = 0.92
                params = @{}
            },
            @{
                id = "desk-5"
                type = "sticker"
                src = $captureCardUrl
                x = 660
                y = 390
                w = 360
                h = 225
                minified = $false
                opacityNormal = 1
                opacityMini = 0.92
                params = @{}
            }
        )
        links = @()
        groups = @()
        recycleBin = @()
        referenceLibrary = @()
    } | ConvertTo-Json -Depth 8
}
