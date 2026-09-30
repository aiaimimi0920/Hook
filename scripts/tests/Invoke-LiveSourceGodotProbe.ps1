[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$GodotExe)
$ErrorActionPreference = "Stop"
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$output = Join-Path $repo ("artifacts/live-source-godot/" + (Get-Date -Format "yyyyMMdd-HHmmss"))
if (Test-Path -LiteralPath $output) { throw "Godot probe evidence already exists" }
$exe = (Resolve-Path -LiteralPath $GodotExe).Path
$fixture = Join-Path $PSScriptRoot "fixtures/LiveSourceGodotFixture.gd"
New-Item -ItemType Directory -Path $output | Out-Null
[IO.File]::WriteAllText((Join-Path $output "project.godot"), "config_version=5`n", [Text.UTF8Encoding]::new($false))
$oldOutput = $env:HOOK_LIVE_GODOT_OUTPUT
$oldPid = $env:HOOK_LIVE_GODOT_PID
$process = $null
$passed = $false
try {
    $env:HOOK_LIVE_GODOT_OUTPUT = $output
    $process = Start-Process -FilePath $exe -WorkingDirectory $output -WindowStyle Hidden -PassThru `
        -ArgumentList @("--path", "`"$output`"", "--script", "`"$fixture`"", "--rendering-method", "gl_compatibility", "--position", "-10000,-10000") `
        -RedirectStandardOutput (Join-Path $output "godot.stdout.log") -RedirectStandardError (Join-Path $output "godot.stderr.log")
    $env:HOOK_LIVE_GODOT_PID = [string]$process.Id
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath (Join-Path $output "ready.json"))) {
        if ($process.HasExited) { throw "Owned Godot fixture exited before ready" }
        if ([DateTime]::UtcNow -ge $deadline) { throw "Owned Godot fixture ready timeout" }
        Start-Sleep -Milliseconds 100
    }
    Push-Location $repo
    try {
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            & cargo test --manifest-path src-tauri/Cargo.toml --lib real_godot_source_button_responds_to_window_input -- --ignored --nocapture *> (Join-Path $output "input-test.log")
            $testExitCode = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        if ($testExitCode -ne 0) { throw "Godot source-input regression failed" }
        $passed = $true
    } finally { Pop-Location }
} finally {
    if ($process -and -not $process.HasExited) {
        $null = $process.CloseMainWindow()
        if (-not $process.WaitForExit(5000)) {
            Stop-Process -Id $process.Id -Force
            $null = $process.WaitForExit(5000)
        }
    }
    $env:HOOK_LIVE_GODOT_OUTPUT = $oldOutput
    $env:HOOK_LIVE_GODOT_PID = $oldPid
    $summary = [ordered]@{
        passed = $passed; godotExe = $exe; output = $output
        ownedPid = $(if ($process) { $process.Id } else { $null })
        ownedProcessStopped = (-not $process -or $process.HasExited)
    }
    [IO.File]::WriteAllText((Join-Path $output "summary.json"), ($summary | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}
Write-Output $output
