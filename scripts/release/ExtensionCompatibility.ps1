<# Validates the cross-repository extension compatibility evidence. #>

function Assert-HookCompatibilityFeatures {
    param([object]$Requirement, [string[]]$Expected, [string]$Label)

    $actual = @($Requirement.requiredFeatures | ForEach-Object { [string]$_ } | Sort-Object)
    $expectedSorted = @($Expected | Sort-Object)
    if ([string]$Requirement.minimum -cne "1.0" -or
        ($actual -join ",") -cne ($expectedSorted -join ",")) {
        throw "Extension compatibility evidence has invalid $Label requirements."
    }
}

function Read-HookExtensionCompatibility {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        throw "Extension compatibility evidence is missing: $resolved"
    }
    [void](Assert-HookAbsolutePathNoReparsePoints -Path $resolved -TrustedRootPath (Split-Path -Parent $resolved))
    $document = Read-HookBoundedText -Path $resolved -MaxBytes 256KB | ConvertFrom-Json
    if ([int]$document.schemaVersion -ne 1 -or
        [string]$document.protocol -ne "loom.extension.v1" -or
        [string]$document.target -ne "windows-x64" -or
        [string]$document.packageSchema.id -ne "loom.capability.package.v1" -or
        [int]$document.packageSchema.version -ne 1) {
        throw "Extension compatibility evidence uses an unsupported contract."
    }
    foreach ($api in @($document.hook.extensionApi, $document.loom.extensionApi)) {
        if ([string]$api.minimum -ne "1.0" -or [string]$api.maximum -ne "1.0") {
            throw "Extension compatibility evidence has an unsupported API range."
        }
    }
    Assert-HookCompatibilityFeatures `
        -Requirement $document.pluginHostRequirements.loomCapabilityApi `
        -Expected @("commands.v1", "attachments.v1") -Label "Loom capability host"
    Assert-HookCompatibilityFeatures `
        -Requirement $document.pluginHostRequirements.hookExtensionApi `
        -Expected @("commands.v1", "unit-overlays.v1") -Label "Hook extension host"
    Assert-HookCompatibilityFeatures `
        -Requirement $document.pluginHostRequirements.surfaceApi `
        -Expected @("declarative.v1") -Label "Surface host"
    return $document
}

function Assert-HookExtensionCompatibility {
    param(
        [Parameter(Mandatory = $true)][object]$Document,
        [Parameter(Mandatory = $true)][string]$GitHead,
        [Parameter(Mandatory = $true)][string]$ExecutablePath
    )

    $digest = Get-HookReleaseDigest -Path $ExecutablePath
    if ([string]$Document.hook.commit -cne $GitHead -or
        [string]$Document.hook.executable.name -cne "hook.exe" -or
        ([string]$Document.hook.executable.path).Replace("\", "/") -cne "portable/hook.exe" -or
        [int64]$Document.hook.executable.bytes -ne $digest.bytes -or
        [string]$Document.hook.executable.sha256 -cne $digest.sha256) {
        throw "Extension compatibility evidence does not match this Hook executable and commit."
    }
    if (@($Document.surfaceFeatures) -notcontains "declarative.v1") {
        throw "Extension compatibility evidence omits the declarative Surface feature."
    }
}
