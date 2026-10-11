Set-StrictMode -Version Latest

# Formal release paths are untrusted until containment and reparse-point checks pass.
function Assert-OtterSafeRelativePath {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($RelativePath) -or
        $RelativePath.IndexOf([char]0) -ge 0 -or
        [regex]::IsMatch($RelativePath, '[\x00-\x1f:]') -or
        [System.IO.Path]::IsPathRooted($RelativePath)) {
        throw "Invalid Otter release-relative path: $RelativePath"
    }
    $normalized = $RelativePath.Replace("/", "\")
    foreach ($segment in $normalized.Split(@("\"), [System.StringSplitOptions]::None)) {
        $baseName = $segment.Split('.')[0]
        if ([string]::IsNullOrWhiteSpace($segment) -or $segment -in @(".", "..") -or
            $segment.EndsWith(" ") -or $segment.EndsWith(".") -or
            $baseName -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') {
            throw "Invalid Otter release-relative path: $RelativePath"
        }
    }
    return $normalized
}

function Resolve-OtterReleasePath {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][string]$RelativePath
    )
    $root = [System.IO.Path]::GetFullPath($RootPath).TrimEnd("\", "/")
    $relative = Assert-OtterSafeRelativePath -RelativePath $RelativePath
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $candidate.StartsWith($root + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Otter release path escapes its root: $RelativePath"
    }
    return $candidate
}

function Assert-OtterNoReparsePoints {
    param(
        [Parameter(Mandatory = $true)][string]$RootPath,
        [Parameter(Mandatory = $true)][string]$Path
    )
    $root = [System.IO.Path]::GetFullPath($RootPath).TrimEnd("\", "/")
    $candidate = [System.IO.Path]::GetFullPath($Path)
    if ($candidate -ne $root -and -not $candidate.StartsWith($root + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Otter release path is outside its trusted root: $candidate"
    }
    $current = $root
    $paths = @($root)
    $relative = $candidate.Substring($root.Length).TrimStart("\", "/")
    foreach ($segment in $relative.Split(@("\"), [System.StringSplitOptions]::RemoveEmptyEntries)) {
        $current = Join-Path $current $segment
        $paths += $current
    }
    foreach ($entry in $paths) {
        if (-not (Test-Path -LiteralPath $entry)) { break }
        if (((Get-Item -LiteralPath $entry -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Otter release paths must not contain reparse points: $entry"
        }
    }
}

function Assert-OtterAbsolutePathNoReparsePoints {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [string]$TrustedRootPath = ""
    )
    $candidate = [System.IO.Path]::GetFullPath($Path)
    $trustedRoot = if ([string]::IsNullOrWhiteSpace($TrustedRootPath)) {
        Split-Path -Parent $candidate
    } else {
        [System.IO.Path]::GetFullPath($TrustedRootPath)
    }
    Assert-OtterNoReparsePoints -RootPath $trustedRoot -Path $candidate
    return $candidate
}

function Get-OtterSafeReleaseFiles {
    param([Parameter(Mandatory = $true)][string]$RootPath)
    $root = [System.IO.Path]::GetFullPath($RootPath).TrimEnd("\", "/")
    Assert-OtterNoReparsePoints -RootPath $root -Path $root
    $pending = [System.Collections.Generic.Stack[string]]::new()
    $files = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
    $pending.Push($root)
    while ($pending.Count -gt 0) {
        foreach ($item in @(Get-ChildItem -LiteralPath $pending.Pop() -Force)) {
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Otter release paths must not contain reparse points: $($item.FullName)"
            }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) } else { $files.Add($item) }
        }
    }
    return @($files)
}

function Get-OtterReleaseDigest {
    param([Parameter(Mandatory = $true)][string]$Path)
    $item = Get-Item -LiteralPath $Path
    return [pscustomobject]@{
        bytes = [int64]$item.Length
        sha256 = Get-OtterFileSha256 -Path $item.FullName
    }
}

function Read-OtterBoundedText {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int64]$MaxBytes = 4MB
    )
    $item = Get-Item -LiteralPath $Path
    if ($item.Length -gt $MaxBytes) { throw "Otter release file exceeds the $MaxBytes-byte limit: $Path" }
    $encoding = [System.Text.UTF8Encoding]::new($false, $true)
    return [System.IO.File]::ReadAllText($item.FullName, $encoding)
}

function Get-OtterArchiveEntries {
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [int]$MaxEntries = 64,
        [int64]$MaxUncompressedBytes = 1GB
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $paths = [System.Collections.Generic.List[string]]::new()
        $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        $total = 0L
        foreach ($entry in $archive.Entries) {
            if ($archive.Entries.Count -gt $MaxEntries) { throw "Otter archive exceeds its entry limit: $ZipPath" }
            $raw = $entry.FullName.TrimEnd("/", "\")
            if ([string]::IsNullOrWhiteSpace($raw)) { continue }
            $relative = Assert-OtterSafeRelativePath -RelativePath $raw
            if (-not $seen.Add($relative)) { throw "Duplicate Otter archive entry: $relative" }
            if ($entry.Name.Length -eq 0) { continue }
            $total += [int64]$entry.Length
            if ($total -gt $MaxUncompressedBytes) { throw "Otter archive exceeds its uncompressed limit: $ZipPath" }
            $paths.Add($relative)
        }
        return @($paths | Sort-Object)
    } finally {
        $archive.Dispose()
    }
}

function Get-OtterArchiveEntryDigest {
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$EntryName,
        [int64]$MaxBytes = 512MB
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entry = $archive.GetEntry($EntryName.Replace("\", "/"))
        if ($null -eq $entry -or $entry.Length -gt $MaxBytes) { throw "Missing or oversized Otter archive entry: $EntryName" }
        $stream = $entry.Open()
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hash = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
            return [pscustomobject]@{ bytes = [int64]$entry.Length; sha256 = $hash }
        } finally {
            $algorithm.Dispose()
            $stream.Dispose()
        }
    } finally {
        $archive.Dispose()
    }
}

function Read-OtterArchiveEntryText {
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$EntryName,
        [int64]$MaxBytes = 1MB
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entry = $archive.GetEntry($EntryName.Replace("\", "/"))
        if ($null -eq $entry -or $entry.Length -gt $MaxBytes) {
            throw "Missing or oversized Otter archive text entry: $EntryName"
        }
        $stream = $entry.Open()
        $encoding = [System.Text.UTF8Encoding]::new($false, $true)
        $reader = [System.IO.StreamReader]::new($stream, $encoding, $false, 4096, $false)
        try {
            return $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
            $stream.Dispose()
        }
    } finally {
        $archive.Dispose()
    }
}
