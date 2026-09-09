[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$HookExe, [string]$OutputRoot = "",
    [string]$LoomManifestPath = "", [string]$LoomHookWsUrl = "", [switch]$MultiLive,
    [switch]$VideoCadence, [ValidateRange(1, 60)][int]$TargetFps = 60, [switch]$GpuPreview,
    [ValidateRange(0, 60)][int]$FailureHoldSeconds = 0,
    [ValidateRange(30, 600)][int]$RunnerTimeoutSeconds = 300,
    [switch]$FrontendReleaseDiagnostic,
    [ValidateSet(0, 1, 2, 4, 6)][int]$FrontendBenchmarkCount = 0
)
$ErrorActionPreference = "Stop"
if ($GpuPreview -and ($MultiLive -or $VideoCadence)) { throw "GPU preview requires the real Unit parity probe" }
if ($FrontendReleaseDiagnostic -and ($MultiLive -or $VideoCadence)) { throw "Frontend release diagnostic requires the Unit probe" }
if ($FrontendBenchmarkCount -and ($MultiLive -or $VideoCadence -or $FrontendReleaseDiagnostic -or -not $GpuPreview)) { throw "Frontend benchmark requires GPU preview and no other probe mode" }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
$artifacts = Join-Path $repo "artifacts"
if (-not $OutputRoot) { $OutputRoot = Join-Path $artifacts ("live-unit-native/" + (Get-Date -Format "yyyyMMdd-HHmmss")) }
$output = [IO.Path]::GetFullPath($OutputRoot)
if (-not $output.StartsWith($artifacts + "\", [StringComparison]::OrdinalIgnoreCase)) { throw "Output must stay in Hook artifacts" }
if ((Test-Path -LiteralPath $output) -and (Get-ChildItem -LiteralPath $output -Force | Select-Object -First 1)) {
    throw "Output already contains evidence"
}
if (Get-Process -Name hook -ErrorAction SilentlyContinue) { throw "Close the existing Hook explicitly before the isolated probe" }
$exe = (Resolve-Path -LiteralPath $HookExe).Path
New-Item -ItemType Directory -Path $output -Force | Out-Null
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$fixtureExe = Join-Path $output "LiveUnitFixture.exe"
$pointerExe = Join-Path $output "LiveUnitPointerProbe.exe"
& $csc /nologo /target:winexe "/out:$fixtureExe" /reference:System.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $PSScriptRoot "fixtures/LiveScreenshotPhaseZeroFixture.cs")
if ($LASTEXITCODE -ne 0) { throw "Fixture compilation failed" }
& $csc /nologo "/out:$pointerExe" (Join-Path $PSScriptRoot "fixtures/LiveUnitPointerProbe.cs")
if ($LASTEXITCODE -ne 0) { throw "Pointer helper compilation failed" }
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
$listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
$variables = @{
    HOOK_APPDATA_DIR = (Join-Path $output "appdata"); HOOK_LOG_DIR = (Join-Path $output "logs")
    HOOK_STARTUP_MODE = "visible"; HOOK_INITIAL_UI_MODE = "canvas"; HOOK_AUTOSTART_CAPTURE = "0"
    HOOK_ENABLE_LOOM_HOOK = "0"; HOOK_NATIVE_ACCEPTANCE = "1"; HOOK_TEA_INTAKE_ENABLED = "0"
    LOOM_MANIFEST_PATH = (Join-Path $output "missing-loom.json"); LOOM_HOOK_WS_URL = "ws://127.0.0.1:1"
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --remote-allow-origins=*"
    WEBVIEW2_USER_DATA_FOLDER = (Join-Path $output "webview2")
    HOOK_LIVE_GPU_PREVIEW = $(if ($GpuPreview) { "1" } else { "0" })
    HOOK_LIVE_FRONTEND_RELEASE_DIAGNOSTIC = $(if ($FrontendReleaseDiagnostic) { "1" } else { "0" })
    HOOK_LIVE_FRONTEND_BENCHMARK_COUNT = [string]$FrontendBenchmarkCount
}
$old = @{}; $fixture = $null; $secondFixture = $null; $hook = $null; $runner = $null
if ($MultiLive) { $variables.HOOK_LIVE_FIXTURE_BACKGROUND = "1" }
if ($FrontendBenchmarkCount) {
    $variables.HOOK_LIVE_FIXTURE_BACKGROUND = "1"
    $variables.HOOK_LIVE_FIXTURE_VIDEO = "1"
}
if ($VideoCadence) {
    $variables.HOOK_LIVE_FIXTURE_BACKGROUND = "1"
    $variables.HOOK_LIVE_FIXTURE_VIDEO = "1"
}
if ($LoomManifestPath) {
    $variables.HOOK_ENABLE_LOOM_HOOK = "1"
    $variables.LOOM_MANIFEST_PATH = (Resolve-Path -LiteralPath $LoomManifestPath).Path
    $variables.LOOM_HOOK_WS_URL = $LoomHookWsUrl
}
try {
    foreach ($key in $variables.Keys) { $old[$key] = [Environment]::GetEnvironmentVariable($key, "Process"); [Environment]::SetEnvironmentVariable($key, $variables[$key], "Process") }
    $fixture = Start-Process -FilePath $fixtureExe -ArgumentList @((Join-Path $output "fixture-ready.json"), "0", (Join-Path $output "fixture-state.json")) -WindowStyle Hidden -PassThru
    if ($MultiLive) {
        $secondFixture = Start-Process -FilePath $fixtureExe -ArgumentList @((Join-Path $output "second-ready.json"), "0", (Join-Path $output "second-state.json")) -WindowStyle Hidden -PassThru
    }
    $hook = Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Hidden -PassThru
    $ownership = @{ hookPid = $hook.Id; hookExe = $exe; hookStartedAt = $hook.StartTime.ToUniversalTime().ToString("o"); fixturePid = $fixture.Id }
    [IO.File]::WriteAllText((Join-Path $output "owned-processes.json"), ($ownership | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $probe = Join-Path $PSScriptRoot "live-unit-native-probe.mjs"
    if ($MultiLive -or $VideoCadence -or $FrontendBenchmarkCount) {
        $probeName = if ($FrontendBenchmarkCount) { "live-frontend-workload-probe" } elseif ($VideoCadence) { "live-video-cadence-probe" } else { "multi-live-native-probe" }
        $probe = Join-Path $output "$probeName.mjs"
        & (Join-Path $repo "node_modules/.bin/esbuild.cmd") (Join-Path $PSScriptRoot "$probeName.ts") --platform=node --format=esm --packages=external --log-level=error "--outfile=$probe"
        if ($LASTEXITCODE -ne 0) { throw "Multi Live probe compilation failed" }
    }
    $runnerArgs = @($probe, $output, "http://127.0.0.1:$port", $pointerExe, [string]$TargetFps) | ForEach-Object {
        '"' + ($_ -replace '(\\+)$', '$1$1') + '"'
    }
    $node = Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $runner = Start-Process -FilePath $node.Source -ArgumentList $runnerArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $output "runner.stdout.log") -RedirectStandardError (Join-Path $output "runner.stderr.log")
    # Retain the process handle so PowerShell 5.1 can report a fast exit reliably.
    $null = $runner.Handle
    $ownership.runnerPid = $runner.Id
    $ownership.runnerStartedAt = $runner.StartTime.ToUniversalTime().ToString("o")
    [IO.File]::WriteAllText((Join-Path $output "owned-processes.json"), ($ownership | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    if (-not $runner.WaitForExit($RunnerTimeoutSeconds * 1000)) {
        throw "Owned native probe runner exceeded ${RunnerTimeoutSeconds}s: $output"
    }
    $runner.Refresh()
    if ($runner.ExitCode -ne 0) {
        # Opt-in, bounded inspection window; preserve failure and normal finally cleanup.
        if ($FailureHoldSeconds -gt 0) { Start-Sleep -Seconds $FailureHoldSeconds }
        throw "Native live Unit probe failed: $output"
    }
    Write-Output $output
} finally {
    foreach ($process in @($runner, $hook, $fixture, $secondFixture)) {
        try {
            if ($process -and -not $process.HasExited) {
                $null = $process.CloseMainWindow()
                if (-not $process.WaitForExit(5000)) { Stop-Process -InputObject $process -Force }
            }
        } catch {
            # A racing exit must not skip cleanup of the remaining owned processes.
            Write-Warning "Owned probe process cleanup failed: $($_.Exception.Message)"
        }
    }
    foreach ($key in $old.Keys) { [Environment]::SetEnvironmentVariable($key, $old[$key], "Process") }
}
