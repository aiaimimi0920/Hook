Set-StrictMode -Version Latest

function Write-OtterUtf8NoBom {
    param([string]$Path, [string]$Value)
    [System.IO.File]::WriteAllText($Path, $Value, [System.Text.UTF8Encoding]::new($false))
}

function Get-OtterReleaseRelativePath {
    param([string]$RootPath, [string]$Path)
    $root = [System.IO.Path]::GetFullPath($RootPath).TrimEnd("\", "/")
    $full = [System.IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($root + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Cannot make path relative to Otter release root: $full"
    }
    return $full.Substring($root.Length + 1).Replace("/", "\")
}

function New-OtterFileRecord {
    param([string]$RootPath, [string]$Path, [string]$Kind)
    $item = Get-Item -LiteralPath $Path
    $digest = Get-OtterReleaseDigest -Path $item.FullName
    return [ordered]@{
        kind = $Kind
        name = $item.Name
        path = Get-OtterReleaseRelativePath -RootPath $RootPath -Path $item.FullName
        bytes = [int64]$digest.bytes
        sha256 = $digest.sha256
    }
}

function Write-OtterReleaseChecksums {
    param([Parameter(Mandatory = $true)][string]$ReleaseRoot)
    $checksumPath = Resolve-OtterReleasePath -RootPath $ReleaseRoot -RelativePath "checksums.sha256"
    $lines = @(
        Get-OtterSafeReleaseFiles -RootPath $ReleaseRoot |
            Where-Object { $_.FullName -ne $checksumPath } |
            ForEach-Object {
                $relative = Get-OtterReleaseRelativePath -RootPath $ReleaseRoot -Path $_.FullName
                "$(Get-OtterFileSha256 -Path $_.FullName)  $($relative.Replace('\', '/'))"
            } |
            Sort-Object
    )
    Write-OtterUtf8NoBom -Path $checksumPath -Value (($lines -join "`n") + "`n")
    return $checksumPath
}
