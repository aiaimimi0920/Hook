# Win32 window discovery, input, and bounded bitmap capture helpers.

Add-Type -AssemblyName System.Drawing
if (-not ("HookWin32" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class HookWin32 {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
}
"@
}

$DWMWA_EXTENDED_FRAME_BOUNDS = 9
$SW_RESTORE = 9
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$MOUSEEVENTF_RIGHTDOWN = 0x0008
$MOUSEEVENTF_RIGHTUP = 0x0010
$PW_RENDERFULLCONTENT = 0x00000002
$MAX_CAPTURE_DIMENSION = 16384
$MAX_CAPTURE_PIXELS = 100000000

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
        if (-not [HookWin32]::GetWindowRect($Handle, [ref]$bounds)) {
            throw "Failed to read bounds for Hook window $Handle"
        }
    }
    return [pscustomobject]@{
        Left = $bounds.Left
        Top = $bounds.Top
        Width = $bounds.Right - $bounds.Left
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
        if ($ownerProcessId -ne $TargetProcessId -or -not [HookWin32]::IsWindowVisible($Handle)) {
            return $true
        }
        $bounds = Get-WindowBounds -Handle $Handle
        if ($bounds.Width -lt 200 -or $bounds.Height -lt 200) {
            return $true
        }
        $windows.Add([pscustomobject]@{
                Handle = $Handle
                Title = Get-WindowTitle -Handle $Handle
                Left = $bounds.Left
                Top = $bounds.Top
                Width = $bounds.Width
                Height = $bounds.Height
                Area = [long]$bounds.Width * [long]$bounds.Height
            })
        return $true
    }
    [void][HookWin32]::EnumWindows($enumProc, [IntPtr]::Zero)
    return $windows | Sort-Object Area -Descending
}

function Wait-HookWindow {
    param(
        [System.Diagnostics.Process]$Process,
        [int]$TimeoutSeconds = 30
    )
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "Hook process exited with code $($Process.ExitCode) before creating a visible window"
        }
        $window = Get-HookWindowsForProcess -TargetProcessId $Process.Id | Select-Object -First 1
        if ($window) {
            return $window
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for a visible Hook window from process $($Process.Id)"
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
    if (-not [HookWin32]::MoveWindow($Handle, $Left, $Top, $Width, $Height, $true)) {
        throw "Failed to move Hook window $Handle"
    }
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
    if (-not [HookWin32]::ClientToScreen($Handle, [ref]$point)) {
        throw "Failed to translate Hook client coordinates"
    }
    return [pscustomobject]@{ X = $point.X; Y = $point.Y }
}

function Invoke-MouseClick {
    param(
        [int]$X,
        [int]$Y,
        [ValidateSet("Left", "Right")]
        [string]$Button
    )
    if (-not [HookWin32]::SetCursorPos($X, $Y)) {
        throw "Failed to position the mouse cursor"
    }
    Start-Sleep -Milliseconds 100
    if ($Button -eq "Left") {
        [HookWin32]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
        [HookWin32]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
    }
    else {
        [HookWin32]::mouse_event($MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
        [HookWin32]::mouse_event($MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
    }
}

function Assert-ValidBitmapDimensions {
    param([int]$Width, [int]$Height)
    $pixels = [long]$Width * [long]$Height
    if ($Width -le 0 -or $Height -le 0 -or $Width -gt $MAX_CAPTURE_DIMENSION -or
        $Height -gt $MAX_CAPTURE_DIMENSION -or $pixels -gt $MAX_CAPTURE_PIXELS) {
        throw "Unsafe capture bitmap dimensions ${Width}x${Height}"
    }
}

function Save-WindowCapture {
    param([IntPtr]$Handle, [string]$Path)
    $bounds = Get-WindowBounds -Handle $Handle
    Assert-ValidBitmapDimensions -Width $bounds.Width -Height $bounds.Height
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
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
