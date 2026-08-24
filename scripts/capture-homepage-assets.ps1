[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$OutputDir,
    [string]$TempRoot,
    [switch]$KeepProcess
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$ownerDir = Join-Path $scriptDir "capture-homepage-assets"
. (Join-Path $ownerDir "common.ps1")
. (Join-Path $ownerDir "win32-capture.ps1")
. (Join-Path $ownerDir "asset-builder.ps1")
. (Join-Path $ownerDir "session-fixture.ps1")

if (-not $OutputDir) {
    $OutputDir = Join-Path $repoRoot "docs\assets"
}
if (-not $TempRoot) {
    $TempRoot = Join-Path $env:TEMP "hook-homepage-desktop-capture"
}

$exePath = Resolve-HookExePath -RequestedPath $ExePath -RepoRoot $repoRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runRoot = Join-Path $TempRoot "run-$timestamp"
$cardDir = Join-Path $TempRoot "cards"
$roamingRoot = Join-Path $runRoot "appdata-roaming"
$localRoot = Join-Path $runRoot "appdata-local"
$logDir = Join-Path $runRoot "logs"
$screenDir = Join-Path $runRoot "screens"
$sessionDir = Join-Path $roamingRoot "com.yamiyu.hook"

foreach ($dir in @($TempRoot, $cardDir, $runRoot, $roamingRoot, $localRoot, $logDir, $screenDir, $sessionDir, $OutputDir)) {
    Ensure-Directory -Path $dir
}

Render-DemoCards -RepoRoot $repoRoot -CardDir $cardDir
$session = New-HomepageSessionJson `
    -CaptureCardPath (Join-Path $cardDir "demo-capture.png") `
    -StickerCardPath (Join-Path $cardDir "demo-sticker.png") `
    -WorkflowCardPath (Join-Path $cardDir "demo-workflow.png")
Write-Utf8NoBomFile -Path (Join-Path $sessionDir "session.json") -Content $session

# Process-global environment changes are always restored, including when capture or asset tools fail.
$envSnapshot = @{
    APPDATA = $env:APPDATA
    LOCALAPPDATA = $env:LOCALAPPDATA
    HOOK_APPDATA_DIR = $env:HOOK_APPDATA_DIR
    HOOK_LOG_DIR = $env:HOOK_LOG_DIR
    HOOK_STARTUP_MODE = $env:HOOK_STARTUP_MODE
    HOOK_INITIAL_UI_MODE = $env:HOOK_INITIAL_UI_MODE
    HOOK_AUTOSTART_CAPTURE = $env:HOOK_AUTOSTART_CAPTURE
    HOOK_ENABLE_LOOM_HOOK = $env:HOOK_ENABLE_LOOM_HOOK
}
$process = $null

try {
    $env:APPDATA = $roamingRoot
    $env:LOCALAPPDATA = $localRoot
    $env:HOOK_APPDATA_DIR = $sessionDir
    $env:HOOK_LOG_DIR = $logDir
    $env:HOOK_STARTUP_MODE = "visible"
    $env:HOOK_INITIAL_UI_MODE = "canvas"
    $env:HOOK_AUTOSTART_CAPTURE = "0"
    $env:HOOK_ENABLE_LOOM_HOOK = "0"

    $process = Start-Process -FilePath $exePath -PassThru
    $window = Wait-HookWindow -Process $process -TimeoutSeconds 30
    Focus-HookWindow -Handle $window.Handle
    Move-HookWindow -Handle $window.Handle -Left 120 -Top 80 -Width 1360 -Height 860
    $window = Wait-HookWindow -Process $process -TimeoutSeconds 10
    Start-Sleep -Seconds 4

    $overviewRaw = Join-Path $screenDir "overview-raw.png"
    $selectedRaw = Join-Path $screenDir "selected-raw.png"
    $contextRaw = Join-Path $screenDir "context-raw.png"
    [void](Save-WindowCapture -Handle $window.Handle -Path $overviewRaw)

    $scale = Get-WindowScale -Handle $window.Handle
    $clickPoint = Convert-ClientCssPointToScreen -Handle $window.Handle -CssX 220 -CssY 155 -Scale $scale
    Invoke-MouseClick -X $clickPoint.X -Y $clickPoint.Y -Button "Left"
    Start-Sleep -Milliseconds 900
    [void](Save-WindowCapture -Handle $window.Handle -Path $selectedRaw)

    $menuVisible = $false
    for ($attempt = 1; $attempt -le 3 -and -not $menuVisible; $attempt++) {
        Focus-HookWindow -Handle $window.Handle
        Invoke-MouseClick -X $clickPoint.X -Y $clickPoint.Y -Button "Right"
        Start-Sleep -Milliseconds 1000
        [void](Save-WindowCapture -Handle $window.Handle -Path $contextRaw)
        $differenceRatio = Measure-ImageDifferenceRatio -ReferencePath $selectedRaw -CandidatePath $contextRaw
        $menuVisible = $differenceRatio -gt 0.01
    }
    if (-not $menuVisible) {
        throw "Failed to capture a visible context-menu state after 3 right-click attempts."
    }

    Build-HomepageAssets -OverviewPath $overviewRaw -SelectedPath $selectedRaw -ContextPath $contextRaw -OutputDir $OutputDir
    Write-Host "Desktop homepage assets written to $OutputDir"
}
finally {
    if ($process -and -not $KeepProcess) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    foreach ($pair in $envSnapshot.GetEnumerator()) {
        if ($null -eq $pair.Value) {
            Remove-Item "Env:$($pair.Key)" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item "Env:$($pair.Key)" $pair.Value
        }
    }
}
