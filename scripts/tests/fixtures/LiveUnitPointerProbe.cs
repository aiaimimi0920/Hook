using System;
using System.Runtime.InteropServices;
using System.Threading;

// Physical OS input, not CDP DOM events: exercises Hook's native pointer worker.
internal static class LiveUnitPointerProbe
{
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput
    {
        public int X, Y;
        public uint Data, Flags, Time;
        public UIntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public MouseInput Mouse; }
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr info);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);

    private static void WritePointer()
    {
        Point point;
        if (!GetCursorPos(out point)) throw new Exception("Cannot observe desktop pointer");
        Console.WriteLine("{{\"x\":{0},\"y\":{1},\"foreground\":\"{2:x}\"}}", point.X, point.Y, GetForegroundWindow().ToInt64());
    }

    private static void InjectAt(int screenX, int screenY, uint edge)
    {
        int x = screenX - GetSystemMetrics(76), y = screenY - GetSystemMetrics(77);
        int w = GetSystemMetrics(78), h = GetSystemMetrics(79);
        if (x < 0 || y < 0 || x >= w || y >= h) throw new Exception("Pointer outside virtual desktop");
        // Include the edge's intended position in the same native event. A
        // separate move/process/sleep/edge sequence can click a displaced cursor.
        SendMouse(0xC001 | edge, (int)((x + 0.5) * 65536 / w), (int)((y + 0.5) * 65536 / h));
    }

    private static void SendMouse(uint flags, int x, int y)
    {
        var input = new Input { Mouse = new MouseInput { X = x, Y = y, Flags = flags } };
        uint inserted = SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input)));
        if (inserted != 1)
            throw new Exception("Mouse input insertion failed; inserted=" + inserted +
                " win32=" + Marshal.GetLastWin32Error() + " (UIPI may not report a specific error)");
    }

    private static void Main(string[] args)
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        if (args[0] == "client")
        {
            IntPtr hwnd = new IntPtr(Convert.ToInt64(args[1].Replace("0x", ""), 16));
            Rect rect;
            Point point = new Point();
            if (!GetClientRect(hwnd, out rect) || !ClientToScreen(hwnd, ref point)) throw new Exception("Invalid fixture window");
            Console.WriteLine("{{\"x\":{0},\"y\":{1},\"w\":{2},\"h\":{3}}}", point.X, point.Y, rect.R, rect.B);
        }
        else if (args[0] == "show")
        {
            IntPtr hwnd = new IntPtr(Convert.ToInt64(args[1].Replace("0x", ""), 16));
            ShowWindow(hwnd, 5);
            if (!SetWindowPos(hwnd, new IntPtr(-1), 0, 0, 0, 0, 0x0043)) throw new Exception("Fixture show failed");
            SetForegroundWindow(hwnd);
        }
        else if (args[0] == "move")
        {
            // SetCursorPos can bypass WH_MOUSE_LL. Inject a move through the same
            // low-level hook as the injected button edges, on the virtual desktop.
            InjectAt(int.Parse(args[1]), int.Parse(args[2]), 0);
            Thread.Sleep(30);
            WritePointer();
        }
        else if (args[0] == "window")
        {
            IntPtr hwnd = new IntPtr(Convert.ToInt64(args[1].Replace("0x", ""), 16));
            if (!SetWindowPos(hwnd, IntPtr.Zero, int.Parse(args[2]), int.Parse(args[3]), 0, 0, 0x0015)) throw new Exception("SetWindowPos failed");
        }
        else if (args[0] == "down" || args[0] == "up")
        {
            uint edge = args[0] == "down" ? 2u : 4u;
            if (args.Length == 3) InjectAt(int.Parse(args[1]), int.Parse(args[2]), edge);
            else SendMouse(edge, 0, 0);
            WritePointer();
        }
        else if (args[0] == "position") WritePointer();
        else if (args[0] == "process")
        {
            using (var process = System.Diagnostics.Process.GetProcessById(int.Parse(args[1])))
                Console.WriteLine("{{\"cpuSeconds\":{0},\"privateBytes\":{1},\"handles\":{2}}}",
                    process.TotalProcessorTime.TotalSeconds.ToString("R", System.Globalization.CultureInfo.InvariantCulture),
                    process.PrivateMemorySize64, process.HandleCount);
        }
        else if (args[0] == "key")
        {
            for (int i = 1; i < args.Length; i++) keybd_event(byte.Parse(args[i]), 0, 0, UIntPtr.Zero);
            Thread.Sleep(80);
            for (int i = args.Length - 1; i > 0; i--) keybd_event(byte.Parse(args[i]), 0, 2, UIntPtr.Zero);
        }
        else throw new Exception("Unknown probe operation");
    }
}
