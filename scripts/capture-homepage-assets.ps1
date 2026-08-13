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

if (-not $OutputDir) {
    $OutputDir = Join-Path $repoRoot "docs\assets"
}

if (-not $TempRoot) {
    $TempRoot = Join-Path $env:TEMP "hook-homepage-desktop-capture"
}

function Resolve-HookExePath {
    param(
        [string]$RequestedPath,
        [string]$RepoRoot
    )

    if ($RequestedPath) {
        return (Resolve-Path $RequestedPath).Path
    }

    $releaseRoot = (Resolve-Path (Join-Path $RepoRoot "..\release")).Path
    $candidates = Get-ChildItem -Path $releaseRoot -Recurse -Filter "hook.exe" |
        Where-Object { $_.FullName -match "\\Hook(\\|-)" } |
        Sort-Object LastWriteTime -Descending

    if (-not $candidates) {
        throw "No hook.exe found under $releaseRoot"
    }

    return $candidates[0].FullName
}

function Ensure-Directory {
    param([string]$Path)
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Write-Utf8NoBomFile {
    param(
        [string]$Path,
        [string]$Content
    )

    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Render-DemoCards {
    param(
        [string]$RepoRoot,
        [string]$CardDir
    )

    $sourceDir = Join-Path $RepoRoot "docs\assets\homepage-demo-source"
    $nodeScript = @'
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [sourceDir, outDir] = process.argv.slice(2);
const files = ["demo-capture.svg", "demo-sticker.svg", "demo-workflow.svg"];

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
} catch {
  browser = await chromium.launch({ headless: true });
}

try {
  const page = await browser.newPage({
    viewport: { width: 960, height: 540 },
    deviceScaleFactor: 1
  });

  for (const file of files) {
    const svgPath = path.join(sourceDir, file);
    const outputPath = path.join(outDir, file.replace(/\.svg$/i, ".png"));
    const svg = fs.readFileSync(svgPath, "utf8");

    await page.setContent(
      `<html><body style="margin:0;background:transparent;display:grid;place-items:center;min-height:100vh;">${svg}</body></html>`,
      { waitUntil: "load" }
    );

    await page.locator("svg").screenshot({ path: outputPath });
  }
} finally {
  await browser.close();
}
'@

    Push-Location $RepoRoot
    try {
        $nodeScript | node --input-type=module - $sourceDir $CardDir
    }
    finally {
        Pop-Location
    }
}

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class HookWin32 {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
}
"@

$DWMWA_EXTENDED_FRAME_BOUNDS = 9
$SW_RESTORE = 9
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_RIGHTDOWN = 0x0008
$MOUSEEVENTF_RIGHTUP = 0x0010
$PW_RENDERFULLCONTENT = 0x00000002

function Get-WindowTitle {
    param([IntPtr]$Handle)

    $builder = New-Object System.Text.StringBuilder 512
    [void][HookWin32]::GetWindowText($Handle, $builder, $builder.Capacity)
    return $builder.ToString()
}

function Get-WindowBounds {
    param([IntPtr]$Handle)

    $bounds = New-Object "HookWin32+RECT"
    $dwmResult = [HookWin32]::DwmGetWindowAttribute(
        $Handle,
        $DWMWA_EXTENDED_FRAME_BOUNDS,
        [ref]$bounds,
        [System.Runtime.InteropServices.Marshal]::SizeOf([type]"HookWin32+RECT")
    )

    if ($dwmResult -ne 0 -or (($bounds.Right - $bounds.Left) -le 0) -or (($bounds.Bottom - $bounds.Top) -le 0)) {
        [void][HookWin32]::GetWindowRect($Handle, [ref]$bounds)
    }

    [pscustomobject]@{
        Left   = $bounds.Left
        Top    = $bounds.Top
        Width  = $bounds.Right - $bounds.Left
        Height = $bounds.Bottom - $bounds.Top
    }
}

function Get-HookWindowsForProcess {
    param([uint32]$TargetProcessId)

    $windows = New-Object System.Collections.Generic.List[object]
    $enumProc = [HookWin32+EnumWindowsProc]{
        param([IntPtr]$Handle, [IntPtr]$LParam)

        $ownerProcessId = [uint32]0
        [void][HookWin32]::GetWindowThreadProcessId($Handle, [ref]$ownerProcessId)

        if ($ownerProcessId -ne $TargetProcessId) {
            return $true
        }

        if (-not [HookWin32]::IsWindowVisible($Handle)) {
            return $true
        }

        $bounds = Get-WindowBounds -Handle $Handle
        if ($bounds.Width -lt 200 -or $bounds.Height -lt 200) {
            return $true
        }

        $title = Get-WindowTitle -Handle $Handle
        $windows.Add([pscustomobject]@{
                Handle = $Handle
                Title  = $title
                Left   = $bounds.Left
                Top    = $bounds.Top
                Width  = $bounds.Width
                Height = $bounds.Height
                Area   = $bounds.Width * $bounds.Height
            })
        return $true
    }

    [void][HookWin32]::EnumWindows($enumProc, [IntPtr]::Zero)
    return $windows | Sort-Object Area -Descending
}

function Wait-HookWindow {
    param(
        [uint32]$TargetProcessId,
        [int]$TimeoutSeconds = 30
    )

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $window = Get-HookWindowsForProcess -TargetProcessId $TargetProcessId | Select-Object -First 1
        if ($window) {
            return $window
        }
        Start-Sleep -Milliseconds 250
    }

    throw "Timed out waiting for a visible Hook window from process $TargetProcessId"
}

function Focus-HookWindow {
    param([IntPtr]$Handle)

    [void][HookWin32]::ShowWindow($Handle, $SW_RESTORE)
    Start-Sleep -Milliseconds 120
    [void][HookWin32]::SetForegroundWindow($Handle)
    Start-Sleep -Milliseconds 200
}

function Move-HookWindow {
    param(
        [IntPtr]$Handle,
        [int]$Left,
        [int]$Top,
        [int]$Width,
        [int]$Height
    )

    [void][HookWin32]::MoveWindow($Handle, $Left, $Top, $Width, $Height, $true)
    Start-Sleep -Milliseconds 350
}

function Get-WindowScale {
    param([IntPtr]$Handle)

    $dpi = [HookWin32]::GetDpiForWindow($Handle)
    if ($dpi -gt 0) {
        return [double]$dpi / 96.0
    }

    return 1.0
}

function Convert-ClientCssPointToScreen {
    param(
        [IntPtr]$Handle,
        [double]$CssX,
        [double]$CssY,
        [double]$Scale
    )

    $point = New-Object "HookWin32+POINT"
    $point.X = [int][Math]::Round($CssX * $Scale)
    $point.Y = [int][Math]::Round($CssY * $Scale)
    [void][HookWin32]::ClientToScreen($Handle, [ref]$point)

    [pscustomobject]@{
        X = $point.X
        Y = $point.Y
    }
}

function Invoke-MouseClick {
    param(
        [int]$X,
        [int]$Y,
        [ValidateSet("Left", "Right")]
        [string]$Button
    )

    [void][HookWin32]::SetCursorPos($X, $Y)
    Start-Sleep -Milliseconds 100

    switch ($Button) {
        "Left" {
            [HookWin32]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 60
            [HookWin32]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
        }
        "Right" {
            [HookWin32]::mouse_event($MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
            Start-Sleep -Milliseconds 60
            [HookWin32]::mouse_event($MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
        }
    }
}

function Save-ScreenRegionPng {
    param(
        [int]$Left,
        [int]$Top,
        [int]$Width,
        [int]$Height,
        [string]$Path
    )

    $bitmap = New-Object System.Drawing.Bitmap $Width, $Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        $graphics.CopyFromScreen($Left, $Top, 0, 0, $bitmap.Size)
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Save-WindowCapture {
    param(
        [IntPtr]$Handle,
        [string]$Path
    )

    $bounds = Get-WindowBounds -Handle $Handle
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $windowPrinted = $false

    try {
        $hdc = $graphics.GetHdc()
        try {
            $windowPrinted = [HookWin32]::PrintWindow($Handle, $hdc, $PW_RENDERFULLCONTENT)
        }
        finally {
            $graphics.ReleaseHdc($hdc)
        }

        if (-not $windowPrinted) {
            $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
        }

        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }

    return $bounds
}

function Measure-ImageDifferenceRatio {
    param(
        [string]$ReferencePath,
        [string]$CandidatePath
    )

    $reference = [System.Drawing.Bitmap]::FromFile($ReferencePath)
    $candidate = [System.Drawing.Bitmap]::FromFile($CandidatePath)

    try {
        if ($reference.Width -ne $candidate.Width -or $reference.Height -ne $candidate.Height) {
            return 1.0
        }

        $step = 12
        $threshold = 48
        $samples = 0
        $different = 0

        for ($y = 0; $y -lt $reference.Height; $y += $step) {
            for ($x = 0; $x -lt $reference.Width; $x += $step) {
                $a = $reference.GetPixel($x, $y)
                $b = $candidate.GetPixel($x, $y)
                $delta =
                    [Math]::Abs($a.R - $b.R) +
                    [Math]::Abs($a.G - $b.G) +
                    [Math]::Abs($a.B - $b.B)
                if ($delta -gt $threshold) {
                    $different++
                }
                $samples++
            }
        }

        if ($samples -eq 0) {
            return 0.0
        }

        return $different / [double]$samples
    }
    finally {
        $reference.Dispose()
        $candidate.Dispose()
    }
}

function Build-HomepageAssets {
    param(
        [string]$OverviewPath,
        [string]$SelectedPath,
        [string]$ContextPath,
        [string]$OutputDir
    )

    $pythonScript = @'
from PIL import Image
import argparse
import os

parser = argparse.ArgumentParser()
parser.add_argument("--overview", required=True)
parser.add_argument("--selected", required=True)
parser.add_argument("--context", required=True)
parser.add_argument("--outdir", required=True)
args = parser.parse_args()

def resize_to_width(image, width):
    if image.width == width:
        return image.copy()
    height = max(1, round(image.height * (width / image.width)))
    return image.resize((width, height), Image.LANCZOS)

def clamp_crop_box(image, box):
    left, top, right, bottom = box
    left = max(0, min(left, image.width - 1))
    top = max(0, min(top, image.height - 1))
    right = max(left + 1, min(right, image.width))
    bottom = max(top + 1, min(bottom, image.height))
    return (left, top, right, bottom)

overview = Image.open(args.overview).convert("RGB")
selected = Image.open(args.selected).convert("RGB")
context = Image.open(args.context).convert("RGB")

overview_out = resize_to_width(overview, min(overview.width, 1280))
overview_out.save(os.path.join(args.outdir, "hook-home-overview-cropped.png"), optimize=True)

context_crop = clamp_crop_box(context, (120, 150, 980, 760))
context_out = resize_to_width(context.crop(context_crop), 960)
context_out.save(os.path.join(args.outdir, "hook-home-context-menu-cropped.png"), optimize=True)

gif_frames = [
    resize_to_width(frame, min(frame.width, 1120)).convert("P", palette=Image.Palette.ADAPTIVE)
    for frame in (overview, context)
]
gif_frames[0].save(
    os.path.join(args.outdir, "hook-home-demo.gif"),
    save_all=True,
    append_images=gif_frames[1:],
    duration=[1300, 1700],
    loop=0,
    optimize=True,
    disposal=2,
)
'@

    $pythonScript | python - --overview $OverviewPath --selected $SelectedPath --context $ContextPath --outdir $OutputDir
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

$cardCapture = (Join-Path $cardDir "demo-capture.png")
$cardSticker = (Join-Path $cardDir "demo-sticker.png")
$cardWorkflow = (Join-Path $cardDir "demo-workflow.png")

$session = @{
    stickers = @(
        @{
            id = "desk-1"
            type = "sticker"
            src = $cardCapture
            x = 40
            y = 40
            w = 360
            h = 225
            minified = $false
            opacityNormal = 1
            opacityMini = 0.92
            params = @{}
        },
        @{
            id = "desk-2"
            type = "sticker"
            src = $cardSticker
            x = 470
            y = 80
            w = 360
            h = 225
            minified = $false
            opacityNormal = 1
            opacityMini = 0.92
            params = @{}
        },
        @{
            id = "desk-3"
            type = "sticker"
            src = $cardWorkflow
            x = 870
            y = 120
            w = 360
            h = 225
            minified = $false
            opacityNormal = 1
            opacityMini = 0.92
            params = @{}
        },
        @{
            id = "desk-4"
            type = "sticker"
            src = $cardSticker
            x = 220
            y = 350
            w = 360
            h = 225
            minified = $false
            opacityNormal = 1
            opacityMini = 0.92
            params = @{}
        },
        @{
            id = "desk-5"
            type = "sticker"
            src = $cardCapture
            x = 660
            y = 390
            w = 360
            h = 225
            minified = $false
            opacityNormal = 1
            opacityMini = 0.92
            params = @{}
        }
    )
    links = @()
    groups = @()
    recycleBin = @()
    referenceLibrary = @()
} | ConvertTo-Json -Depth 8

$sessionPath = Join-Path $sessionDir "session.json"
Write-Utf8NoBomFile -Path $sessionPath -Content $session

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
    $window = Wait-HookWindow -TargetProcessId $process.Id -TimeoutSeconds 30

    Focus-HookWindow -Handle $window.Handle
    Move-HookWindow -Handle $window.Handle -Left 120 -Top 80 -Width 1360 -Height 860
    $window = Wait-HookWindow -TargetProcessId $process.Id -TimeoutSeconds 10

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
