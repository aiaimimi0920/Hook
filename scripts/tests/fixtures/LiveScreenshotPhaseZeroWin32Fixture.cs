using System;
using System.IO;
using System.Runtime.InteropServices;
using Forms = System.Windows.Forms;

namespace Hook.LiveScreenshot.PhaseZero
{
    internal static class Win32Program
    {
        private const int WmCreate = 0x0001;
        private const int WmDestroy = 0x0002;
        private const int WmPaint = 0x000f;
        private const int WmKeyDown = 0x0100;
        private const int WmKeyUp = 0x0101;
        private const int WmCommand = 0x0111;
        private const int WmTimer = 0x0113;
        private const uint WsVisible = 0x10000000;
        private const uint WsChild = 0x40000000;
        private const uint WsOverlappedWindow = 0x00cf0000;
        private const uint WsTabStop = 0x00010000;
        private const uint WsExTopmost = 0x00000008;
        private const uint BsAutoCheckBox = 0x00000003;
        private const int SwShow = 5;
        private const int ActionButtonId = 1001;
        private const int ProgressId = 1002;
        private const int PbmSetRange = 0x0401;
        private const int PbmSetPos = 0x0402;
        private const int TbmSetRange = 0x0406;
        private const int GwlpWndProc = -4;
        private static readonly WindowProc WindowCallback = HandleWindowMessage;
        private static readonly WindowProc ActionButtonCallback = HandleActionButtonMessage;
        private static string readyPath;
        private static IntPtr status;
        private static IntPtr keyStatus;
        private static IntPtr progress;
        private static IntPtr originalActionButtonProc;
        private static int frame;
        private static int clicks;
        private static int keyEdges;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WindowClass
        {
            public uint Size;
            public uint Style;
            public WindowProc WindowProc;
            public int ClassExtra;
            public int WindowExtra;
            public IntPtr Instance;
            public IntPtr Icon;
            public IntPtr Cursor;
            public IntPtr Background;
            public string MenuName;
            public string ClassName;
            public IntPtr SmallIcon;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Message
        {
            public IntPtr Window;
            public uint Id;
            public IntPtr WParam;
            public IntPtr LParam;
            public uint Time;
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeRect
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PaintStruct
        {
            public IntPtr DeviceContext;
            public bool Erase;
            public NativeRect Paint;
            public bool Restore;
            public bool IncUpdate;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
            public byte[] Reserved;
        }

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate IntPtr WindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern ushort RegisterClassEx(ref WindowClass value);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateWindowEx(uint exStyle, string className, string title, uint style,
            int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")]
        private static extern bool UpdateWindow(IntPtr window);
        [DllImport("user32.dll")]
        private static extern sbyte GetMessage(out Message message, IntPtr window, uint first, uint last);
        [DllImport("user32.dll")]
        private static extern bool TranslateMessage(ref Message message);
        [DllImport("user32.dll")]
        private static extern IntPtr DispatchMessage(ref Message message);
        [DllImport("user32.dll")]
        private static extern IntPtr DefWindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern IntPtr CallWindowProc(IntPtr previous, IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
        private static extern IntPtr SetWindowLongPtr(IntPtr window, int index, IntPtr value);
        [DllImport("user32.dll")]
        private static extern void PostQuitMessage(int exitCode);
        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern bool SetWindowText(IntPtr window, string text);
        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern UIntPtr SetTimer(IntPtr window, UIntPtr id, uint interval, IntPtr callback);
        [DllImport("user32.dll")]
        private static extern bool KillTimer(IntPtr window, UIntPtr id);
        [DllImport("user32.dll")]
        private static extern bool InvalidateRect(IntPtr window, IntPtr rect, bool erase);
        [DllImport("user32.dll")]
        private static extern IntPtr BeginPaint(IntPtr window, out PaintStruct paint);
        [DllImport("user32.dll")]
        private static extern bool EndPaint(IntPtr window, ref PaintStruct paint);
        [DllImport("user32.dll")]
        private static extern int FillRect(IntPtr dc, ref NativeRect rect, IntPtr brush);
        [DllImport("gdi32.dll")]
        private static extern IntPtr CreateSolidBrush(uint color);
        [DllImport("gdi32.dll")]
        private static extern bool DeleteObject(IntPtr value);

        [STAThread]
        private static void Main(string[] args)
        {
            if (args.Length < 1)
            {
                Environment.ExitCode = 2;
                return;
            }
            try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
            catch (EntryPointNotFoundException) { }

            int parsed;
            int screenIndex = args.Length > 1 && int.TryParse(args[1], out parsed) ? parsed : 0;
            Forms.Screen[] screens = Forms.Screen.AllScreens;
            if (screenIndex < 0 || screenIndex >= screens.Length)
            {
                throw new ArgumentOutOfRangeException("screenIndex");
            }
            readyPath = Path.GetFullPath(args[0]);
            IntPtr instance = GetModuleHandle(null);
            const string className = "HookLiveScreenshotPhaseZeroNative";
            var definition = new WindowClass
            {
                Size = (uint)Marshal.SizeOf(typeof(WindowClass)),
                WindowProc = WindowCallback,
                Instance = instance,
                ClassName = className,
            };
            if (RegisterClassEx(ref definition) == 0)
            {
                throw new InvalidOperationException("RegisterClassEx failed");
            }
            Forms.Screen screen = screens[screenIndex];
            int width = 686;
            int height = 470;
            int x = screen.WorkingArea.Left + Math.Max(0, (screen.WorkingArea.Width - width) / 2);
            int y = screen.WorkingArea.Top + Math.Max(0, (screen.WorkingArea.Height - height) / 2);
            IntPtr window = CreateWindowEx(WsExTopmost, className, "Hook Live Screenshot Phase 0 Win32 Fixture",
                WsOverlappedWindow, x, y, width, height, IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
            if (window == IntPtr.Zero)
            {
                throw new InvalidOperationException("CreateWindowEx failed");
            }
            ShowWindow(window, SwShow);
            UpdateWindow(window);
            WriteReadyFile(window);
            Message message;
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0)
            {
                TranslateMessage(ref message);
                DispatchMessage(ref message);
            }
        }

        private static IntPtr HandleWindowMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
        {
            if (message == WmCreate)
            {
                CreateControls(window);
                SetTimer(window, new UIntPtr(1), 80, IntPtr.Zero);
                return IntPtr.Zero;
            }
            if (message == WmCommand && (wParam.ToInt64() & 0xffff) == ActionButtonId)
            {
                clicks++;
                SetWindowText(status, "Clicks: " + clicks);
                return IntPtr.Zero;
            }
            if (message == WmTimer)
            {
                frame++;
                SendMessage(progress, PbmSetPos, new IntPtr(frame % 101), IntPtr.Zero);
                InvalidateRect(window, IntPtr.Zero, true);
                return IntPtr.Zero;
            }
            if (message == WmPaint)
            {
                PaintStruct paint;
                IntPtr dc = BeginPaint(window, out paint);
                IntPtr brush = CreateSolidBrush(frame % 2 == 0 ? 0x00442f24u : 0x00233a4fu);
                var surface = new NativeRect { Left = 32, Top = 45, Right = 635, Bottom = 115 };
                FillRect(dc, ref surface, brush);
                DeleteObject(brush);
                EndPaint(window, ref paint);
                return IntPtr.Zero;
            }
            if (message == WmDestroy)
            {
                KillTimer(window, new UIntPtr(1));
                PostQuitMessage(0);
                return IntPtr.Zero;
            }
            return DefWindowProc(window, message, wParam, lParam);
        }

        private static IntPtr HandleActionButtonMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
        {
            if (message == WmKeyDown || message == WmKeyUp)
            {
                keyEdges++;
                SetWindowText(keyStatus, "Keys: " + keyEdges);
            }
            return CallWindowProc(originalActionButtonProc, window, message, wParam, lParam);
        }

        private static void CreateControls(IntPtr parent)
        {
            IntPtr instance = GetModuleHandle(null);
            CreateChild("STATIC", "Animated classic Win32/UIA fixture", 32, 16, 350, 24, parent, 1000, instance, 0);
            progress = CreateChild("msctls_progress32", "", 32, 125, 590, 26, parent, ProgressId, instance, 0);
            SendMessage(progress, PbmSetRange, IntPtr.Zero, new IntPtr(100 << 16));
            IntPtr actionButton = CreateChild("BUTTON", "Apply action", 32, 165, 130, 32, parent, ActionButtonId, instance, WsTabStop);
            originalActionButtonProc = SetWindowLongPtr(
                actionButton,
                GwlpWndProc,
                Marshal.GetFunctionPointerForDelegate(ActionButtonCallback));
            if (originalActionButtonProc == IntPtr.Zero)
            {
                throw new InvalidOperationException("Failed to subclass action button");
            }
            status = CreateChild("STATIC", "Clicks: 0", 180, 170, 150, 24, parent, 1003, instance, 0);
            keyStatus = CreateChild("STATIC", "Keys: 0", 350, 170, 150, 24, parent, 1007, instance, 0);
            CreateChild("EDIT", "editable text", 32, 215, 360, 28, parent, 1004, instance, WsTabStop | 0x00800000);
            CreateChild("BUTTON", "Enabled", 32, 255, 150, 28, parent, 1005, instance, WsTabStop | BsAutoCheckBox);
            IntPtr slider = CreateChild("msctls_trackbar32", "Range value", 32, 300, 590, 45, parent, 1006, instance, WsTabStop);
            SendMessage(slider, TbmSetRange, new IntPtr(1), new IntPtr(100 << 16));
        }

        private static IntPtr CreateChild(string className, string text, int x, int y, int width, int height,
            IntPtr parent, int id, IntPtr instance, uint style)
        {
            return CreateWindowEx(0, className, text, WsChild | WsVisible | style, x, y, width, height,
                parent, new IntPtr(id), instance, IntPtr.Zero);
        }

        private static void WriteReadyFile(IntPtr window)
        {
            NativeRect rect;
            if (!GetWindowRect(window, out rect))
            {
                throw new InvalidOperationException("GetWindowRect failed");
            }
            Directory.CreateDirectory(Path.GetDirectoryName(readyPath));
            string json = string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "{{\"schemaVersion\":1,\"hwnd\":\"0x{0:x}\",\"bounds\":[{1},{2},{3},{4}]}}",
                window.ToInt64(), rect.Left, rect.Top, rect.Right, rect.Bottom);
            File.WriteAllText(readyPath, json);
        }
    }
}
