[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}
function Read-RepoText {
    param([string]$RelativePath)
    $path = Join-Path $repoRoot $RelativePath
    Assert-True (Test-Path -LiteralPath $path -PathType Leaf) "Missing dependency security file: $RelativePath"
    return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

$policy = Read-RepoText "security\dependency-security-policy.json" | ConvertFrom-Json
Assert-True ([int]$policy.schemaVersion -eq 1) "Unsupported dependency security policy schema."
Assert-True ($policy.scanner.version -eq "2.5.0") "Dependency scanner version is not pinned."
Assert-True ($policy.scanner.reusableWorkflow -eq "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@0c58c542420dfd23fcac08dd9c8ca3cca9c36f1a") "OSV workflow pin changed without review."
Assert-True ($policy.scanner.actionCommit -eq "06b2ab4348248b456ee06c9e953637f55e03504f") "OSV action pin changed without review."
Assert-True ($policy.scanner.windowsX64Sha256 -eq "4342285bd8be36b9f113468f3eea86e7900befbcd19ca8dc6ac4f0f6cbe7c362") "OSV Windows hash changed without review."
Assert-True ([int]$policy.maximumExceptionDays -gt 0 -and [int]$policy.maximumExceptionDays -le 90) "Exception lifetime must be at most 90 days."

$expectedLockfiles = @(
    "package-lock.json",
    "src-tauri/Cargo.lock",
    "src-tauri/crates/drag/Cargo.lock",
    "src-tauri/crates/scap-direct3d/Cargo.lock"
)
Assert-True ($policy.lockfiles.Count -eq $expectedLockfiles.Count) "Dependency lockfile inventory changed without review."
foreach ($lockfile in $expectedLockfiles) {
    Assert-True ($policy.lockfiles -contains $lockfile) "Policy does not scan lockfile: $lockfile"
    Assert-True (Test-Path -LiteralPath (Join-Path $repoRoot $lockfile) -PathType Leaf) "Configured lockfile is missing: $lockfile"
}

$config = Read-RepoText ([string]$policy.config).Replace('/', '\')
Assert-True (-not $config.Contains("[[PackageOverrides]]")) "Broad package overrides are forbidden."
$blocks = [regex]::Matches($config, '(?ms)^\[\[IgnoredVulns\]\]\s*(.*?)(?=^\[\[|\z)')
$seen = @{}
$today = [DateTime]::UtcNow.Date
foreach ($match in $blocks) {
    $block = $match.Groups[1].Value
    $idMatch = [regex]::Match($block, '(?m)^id\s*=\s*"([A-Z0-9-]+)"\s*$')
    $dateMatch = [regex]::Match($block, '(?m)^ignoreUntil\s*=\s*(\d{4}-\d{2}-\d{2})\s*$')
    $reasonMatch = [regex]::Match($block, '(?m)^reason\s*=\s*"([^"\r\n]+)"\s*$')
    Assert-True $idMatch.Success "Every exception requires one vulnerability ID."
    Assert-True $dateMatch.Success "Exception requires ignoreUntil."
    Assert-True ($reasonMatch.Success -and $reasonMatch.Groups[1].Value.Length -ge 40) "Exception requires a concrete reason."
    $id = $idMatch.Groups[1].Value
    Assert-True (-not $seen.ContainsKey($id)) "Duplicate vulnerability exception: $id"
    $seen[$id] = $true
    $expiry = [DateTime]::ParseExact($dateMatch.Groups[1].Value, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
    Assert-True ($expiry -gt $today) "Vulnerability exception expired: $id"
    Assert-True ($expiry -le $today.AddDays([int]$policy.maximumExceptionDays)) "Vulnerability exception exceeds maximum lifetime: $id"
}

$workflow = Read-RepoText ".github\workflows\dependency-security.yml"
foreach ($required in @($policy.scanner.reusableWorkflow, "fail-on-vuln: true", "upload-sarif: true", "security-events: write", "checkout-ref") + $expectedLockfiles) {
    Assert-True $workflow.Contains($required) "Dependency workflow lost required contract: $required"
}
$release = Read-RepoText ".github\workflows\release-hook-tag.yml"
Assert-True $release.Contains("uses: ./.github/workflows/dependency-security.yml") "Tag release does not call dependency security."
Assert-True $release.Contains("needs: dependency-security") "Tag release is not blocked on dependency security."

foreach ($scriptAndTerms in @(
    @("scripts\Install-OsvScanner.ps1", "Assert-ScannerHash", "Invoke-WebRequest"),
    @("scripts\Invoke-DependencySecurityScan.ps1", "--version", "--config=", "--lockfile=")
)) {
    $source = Read-RepoText $scriptAndTerms[0]
    foreach ($term in $scriptAndTerms[1..($scriptAndTerms.Count - 1)]) {
        Assert-True $source.Contains($term) "Dependency script lost required control: $term"
    }
}
Write-Output "Hook dependency security contract passed: locks=4 exceptions=$($blocks.Count) max-days=$($policy.maximumExceptionDays)"
