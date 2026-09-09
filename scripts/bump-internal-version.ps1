[CmdletBinding()]
param([string]$RepoRoot = (Join-Path $PSScriptRoot ".."))

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "version-identity.ps1")
$root = [IO.Path]::GetFullPath($RepoRoot)
$path = Join-Path $root "version-state.json"
$lockPath = Join-Path $root ".tmp\internal-version.lock"
[void][IO.Directory]::CreateDirectory((Split-Path $lockPath))
# Serialize revision allocation without touching any public package version.
$lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$temporary = "$path.$([Guid]::NewGuid().ToString('N')).tmp"
try {
    $identity = Get-HookVersionIdentity -RepoRoot $root
    if ($identity.internalRevision -eq 65535) { throw "Internal revision exhausted; choose a new public base explicitly." }
    $state = [ordered]@{ publicVersion = $identity.productVersion; internalRevision = $identity.internalRevision + 1 }
    [IO.File]::WriteAllText($temporary, (($state | ConvertTo-Json) + "`n"), [Text.UTF8Encoding]::new($false))
    [IO.File]::Replace($temporary, $path, [NullString]::Value)
    (Get-HookVersionIdentity -RepoRoot $root).buildVersion
} finally {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    $lock.Dispose()
}
