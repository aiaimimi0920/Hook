Set-StrictMode -Version Latest

function Write-HookUtf8NoBom {
    param([string]$Path, [string]$Value)
    [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}

function Get-HookReleaseRelativePath {
    param([string]$RootPath, [string]$Path)
    $root = [System.IO.Path]::GetFullPath($RootPath).TrimEnd("\", "/")
    $full = [System.IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($root + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Cannot make path relative to Hook release root: $full"
    }
    return $full.Substring($root.Length + 1).Replace("/", "\")
}

function New-HookFileRecord {
    param([string]$RootPath, [string]$Path, [string]$Kind)
    $item = Get-Item -LiteralPath $Path
    $digest = Get-HookReleaseDigest -Path $item.FullName
    return [ordered]@{
        kind = $Kind
        name = $item.Name
        path = Get-HookReleaseRelativePath -RootPath $RootPath -Path $item.FullName
        bytes = [int64]$digest.bytes
        sha256 = $digest.sha256
    }
}

function Write-HookReleaseChecksums {
    param([Parameter(Mandatory = $true)][string]$ReleaseRoot)
    $checksumPath = Resolve-HookReleasePath -RootPath $ReleaseRoot -RelativePath "checksums.sha256"
    $lines = @(
        Get-HookSafeReleaseFiles -RootPath $ReleaseRoot |
            Where-Object { $_.FullName -ne $checksumPath } |
            ForEach-Object {
                $relative = Get-HookReleaseRelativePath -RootPath $ReleaseRoot -Path $_.FullName
                "$(Get-HookFileSha256 -Path $_.FullName)  $($relative.Replace('\', '/'))"
            } |
            Sort-Object
    )
    Write-HookUtf8NoBom -Path $checksumPath -Value (($lines -join "`n") + "`n")
    return $checksumPath
}
