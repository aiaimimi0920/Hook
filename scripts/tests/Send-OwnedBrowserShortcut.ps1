[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][int]$BrowserProcessId,
    [Parameter(Mandatory = $true)][string]$Profile,
    [ValidateSet('Ctrl2', 'BrowserAction')][string]$Chord = 'Ctrl2',
    [ValidateRange(0, 60)][int]$WaitForForegroundSeconds = 0,
    [switch]$FocusOwnedWindow
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../artifacts'))
$profilePath = [IO.Path]::GetFullPath($Profile)
if (-not $profilePath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Only an owned test profile is allowed' }
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$BrowserProcessId"
if (-not $process -or $process.ExecutablePath -ne 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -or
    -not $process.CommandLine.Contains('--user-data-dir=' + $profilePath)) { throw 'Owned Edge process identity mismatch' }
if (-not [Environment]::Is64BitProcess) { throw '64-bit test runner required' }
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OwnedBrowserKeys {
  [StructLayout(LayoutKind.Sequential)] public struct Key {
    public ushort vk, scan; public uint flags, time; public UIntPtr extra;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse {
    public int dx, dy; public uint data, flags, time; public UIntPtr extra;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Explicit, Size=40)] public struct Input {
    [FieldOffset(0)] public uint type; [FieldOffset(8)] public Key key;
    [FieldOffset(8)] public Mouse mouse;
  }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr dc, uint flags);
  public static void SnapshotOwned(IntPtr hwnd, uint expectedPid, string path) {
    uint pid; GetWindowThreadProcessId(hwnd,out pid); Rect rect;
    if(pid!=expectedPid || !GetWindowRect(hwnd,out rect)) return;
    int w=rect.right-rect.left,h=rect.bottom-rect.top;
    if(w<1 || h<1 || w>4096 || h>2160) return;
    using(var bitmap=new System.Drawing.Bitmap(w,h)) using(var graphics=System.Drawing.Graphics.FromImage(bitmap)) {
      var dc=graphics.GetHdc(); bool ok;
      try { ok=PrintWindow(hwnd,dc,2); } finally { graphics.ReleaseHdc(dc); }
      if(ok) bitmap.Save(path,System.Drawing.Imaging.ImageFormat.Png);
    }
  }
  public static string DescribeOwned(IntPtr hwnd, uint expectedPid) {
    uint pid; GetWindowThreadProcessId(hwnd,out pid);
    if(pid!=expectedPid) return "not-owned";
    var name=new StringBuilder(256); var title=new StringBuilder(256);
    GetClassName(hwnd,name,256); GetWindowText(hwnd,title,256);
    return "hwnd="+hwnd+" class="+name+" title="+title;
  }
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  static Input K(ushort key, bool up) { return new Input { type=1, key=new Key { vk=key, flags=up?2u:0u } }; }
  static Input M(bool up) { return new Input { type=0, mouse=new Mouse { flags=up?4u:2u } }; }
  public static void FocusOwned(IntPtr hwnd, uint expectedPid) {
    uint pid; GetWindowThreadProcessId(hwnd, out pid);
    if (pid != expectedPid) throw new Exception("Owned window identity mismatch");
    for (int key=1; key<255; key++)
      if (GetAsyncKeyState(key)<0) throw new Exception("Refusing focus click while user input is held");
    var context=SetThreadDpiAwarenessContext(new IntPtr(-4));
    if (context==IntPtr.Zero) throw new Exception("Physical window coordinates unavailable");
    bool topmost=(GetWindowLongPtrW(hwnd,-20).ToInt64()&8)!=0;
    Point saved=new Point(), click=new Point(); bool moved=false;
    try {
      Rect rect;
      if (!GetWindowRect(hwnd,out rect) || rect.right-rect.left<400 || rect.bottom-rect.top<100 || !GetCursorPos(out saved))
        throw new Exception("Owned browser geometry unavailable");
      if (!SetWindowPos(hwnd,new IntPtr(-1),0,0,0,0,0x13)) throw new Exception("Cannot expose owned browser");
      click=new Point { x=(rect.left+rect.right)/2, y=rect.top+12 };
      if (GetAncestor(WindowFromPoint(click),2)!=hwnd) throw new Exception("Owned caption is occluded");
      if (!SetCursorPos(click.x,click.y)) throw new Exception("Cannot position owned focus click");
      moved=true;
      Point actual;
      if (!GetCursorPos(out actual) || actual.x!=click.x || actual.y!=click.y || GetAncestor(WindowFromPoint(actual),2)!=hwnd)
        throw new Exception("Focus click target changed");
      if (SendInput(2,new Input[]{M(false),M(true)},40)!=2) {
        SendInput(1,new Input[]{M(true)},40); throw new Exception("Owned focus click failed");
      }
      System.Threading.Thread.Sleep(100);
    } finally {
      if (!topmost) SetWindowPos(hwnd,new IntPtr(-2),0,0,0,0,0x13);
      Point actual;
      if (moved && GetCursorPos(out actual) && actual.x==click.x && actual.y==click.y) SetCursorPos(saved.x,saved.y);
      SetThreadDpiAwarenessContext(context);
    }
  }
  public static void Send(bool shift, uint expectedPid, IntPtr expectedWindow) {
    var foreground=GetForegroundWindow();
    uint pid; GetWindowThreadProcessId(foreground, out pid);
    if (pid != expectedPid || foreground != expectedWindow)
      throw new Exception("Owned browser window is not foreground: actual=" + pid + "/" + foreground + ", expected=" + expectedPid + "/" + expectedWindow);
    foreach (int key in new int[]{0x10,0x11,0x12,0x5b,0x5c,0x32})
      if (GetAsyncKeyState(key)<0) throw new Exception("Refusing to interfere with held user keys");
    var input=shift ? new Input[]{K(0x11,false),K(0x10,false),K(0x32,false),K(0x32,true),K(0x10,true),K(0x11,true)}
      : new Input[]{K(0x11,false),K(0x32,false),K(0x32,true),K(0x11,true)};
    if (SendInput((uint)input.Length,input,40)!=(uint)input.Length) {
      var release=new Input[]{K(0x32,true),K(0x10,true),K(0x11,true)}; SendInput(3,release,40);
      throw new Exception("Input batch failed");
    }
  }
}
'@
$browser = Get-Process -Id $BrowserProcessId
if ($browser.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Owned browser has no main window' }
$null = [OwnedBrowserKeys]::ShowWindow($browser.MainWindowHandle, 9)
$null = [OwnedBrowserKeys]::SetForegroundWindow($browser.MainWindowHandle)
Start-Sleep -Milliseconds 200
[uint32]$foregroundId = 0
$null = [OwnedBrowserKeys]::GetWindowThreadProcessId([OwnedBrowserKeys]::GetForegroundWindow(), [ref]$foregroundId)
if ($FocusOwnedWindow -and ($foregroundId -ne $BrowserProcessId -or
    [OwnedBrowserKeys]::GetForegroundWindow() -ne $browser.MainWindowHandle)) {
    # Only the isolated profile's verified window may receive this real caption click.
    [OwnedBrowserKeys]::FocusOwned($browser.MainWindowHandle, [uint32]$BrowserProcessId)
    $null = [OwnedBrowserKeys]::GetWindowThreadProcessId([OwnedBrowserKeys]::GetForegroundWindow(), [ref]$foregroundId)
}
$deadline = [DateTime]::UtcNow.AddSeconds($WaitForForegroundSeconds)
while (($foregroundId -ne $BrowserProcessId -or [OwnedBrowserKeys]::GetForegroundWindow() -ne $browser.MainWindowHandle) -and
    [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
    $null = [OwnedBrowserKeys]::GetWindowThreadProcessId([OwnedBrowserKeys]::GetForegroundWindow(), [ref]$foregroundId)
}
$foreground = Get-Process -Id $foregroundId -ErrorAction SilentlyContinue
Write-Output "Foreground process: $foregroundId $($foreground.ProcessName); owned window: $($browser.MainWindowHandle)"
Write-Output ([OwnedBrowserKeys]::DescribeOwned([OwnedBrowserKeys]::GetForegroundWindow(), [uint32]$BrowserProcessId))
[OwnedBrowserKeys]::SnapshotOwned([OwnedBrowserKeys]::GetForegroundWindow(), [uint32]$BrowserProcessId,
    (Join-Path (Split-Path $profilePath) 'shortcut-foreground.png'))
[OwnedBrowserKeys]::Send(($Chord -eq 'BrowserAction'), [uint32]$BrowserProcessId, $browser.MainWindowHandle)
Write-Output 'Sent shortcut only to verified owned Edge window'
for ($sample = 0; $sample -lt 8; $sample++) {
    Start-Sleep -Milliseconds 250
    $null = [OwnedBrowserKeys]::GetWindowThreadProcessId([OwnedBrowserKeys]::GetForegroundWindow(), [ref]$foregroundId)
    Write-Output "Post-shortcut foreground match: $($foregroundId -eq $BrowserProcessId)"
}
