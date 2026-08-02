[CmdletBinding()]
param(
    [string]$ManifestPath = "src-tauri\Cargo.toml"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertTo-GitHubCommandValue {
    param([string]$Value)

    return $Value.Replace("%", "%25").Replace("`r", "%0D").Replace("`n", "%0A")
}

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    $testOutput = @(& cargo test --manifest-path $ManifestPath -- --test-threads=1 2>&1)
    $testExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

$testOutput | ForEach-Object { Write-Host ([string]$_) }

if ($testExitCode -eq 0) {
    exit 0
}

$diagnosticLines = @(
    $testOutput |
        ForEach-Object { [string]$_ } |
        Where-Object {
            $_ -match '(?i)\bFAILED\b|panicked at|failures:|error:|test result:|timed out|WouldBlock|Disconnected'
        } |
        Select-Object -Last 60
)

if ($diagnosticLines.Count -eq 0) {
    $diagnosticLines = @($testOutput | ForEach-Object { [string]$_ } | Select-Object -Last 60)
}

$diagnostic = "cargo test exited with code $testExitCode.`n" + ($diagnosticLines -join "`n")
$escapedDiagnostic = ConvertTo-GitHubCommandValue -Value $diagnostic
Write-Output "::error title=Rust tests failed::$escapedDiagnostic"
exit $testExitCode
