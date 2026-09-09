function Get-HookVersionIdentity {
    param(
        [Parameter(Mandatory = $true)][string]$RepoRoot,
        [switch]$PublicRelease
    )
    $package = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $RepoRoot "package.json") | ConvertFrom-Json
    $state = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $RepoRoot "version-state.json") | ConvertFrom-Json
    $version = [string]$package.version
    if ($version -cnotmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$' -or
        [string]$state.publicVersion -cne $version) {
        throw "Version state must match the three-part public product version."
    }
    $revision = $state.internalRevision
    if (($revision -isnot [int] -and $revision -isnot [long]) -or $revision -lt 0 -or $revision -gt 65535) {
        throw "Internal revision must be an integer between 0 and 65535."
    }
    [pscustomobject]@{
        productVersion = $version
        internalRevision = $revision
        internalVersion = "v$version.$revision"
        buildVersion = $(if ($PublicRelease) { "v$version" } else { "v$version.$revision" })
        channel = $(if ($PublicRelease) { "public" } else { "internal" })
    }
}

function Assert-HookPublicBuildIdentity {
    param([Parameter(Mandatory = $true)]$Provenance, [Parameter(Mandatory = $true)][string]$ProductVersion)
    if ([string]$Provenance.channel -cne "public" -or
        [string]$Provenance.buildVersion -cne "v$ProductVersion" -or
        [string]$Provenance.productVersion -cne $ProductVersion) {
        throw "Formal publication requires a public build identity; internal candidates cannot be published."
    }
}
