using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace Hook.LiveScreenshot.PhaseZero
{
    internal static class WpfProgram
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [STAThread]
        private static void Main(string[] args)
        {
            if (args.Length < 1)
            {
                Environment.ExitCode = 2;
                return;
            }

            try
            {
                SetProcessDpiAwarenessContext(new IntPtr(-4));
            }
            catch (EntryPointNotFoundException)
            {
                // Older Windows versions remain valid baseline targets.
            }

            int parsed;
            int screenIndex = args.Length > 1 && int.TryParse(args[1], out parsed) ? parsed : 0;
            var app = new Application();
            app.Run(new FixtureWindow(args[0], screenIndex));
        }
    }

    internal sealed class FixtureWindow : Window
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct NativePoint
        {
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

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromPoint(NativePoint point, uint flags);

        [DllImport("shcore.dll")]
        private static extern int GetDpiForMonitor(IntPtr monitor, int dpiType, out uint dpiX, out uint dpiY);

        private readonly string readyPath;
        private readonly DispatcherTimer timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(80) };
        private readonly ProgressBar progress = new ProgressBar { Minimum = 0, Maximum = 100, Height = 28 };
        private readonly TextBlock frameLabel = new TextBlock { Text = "Frame: 0" };
        private readonly TextBlock statusLabel = new TextBlock { Text = "Clicks: 0" };
        private readonly Border animatedSurface = new Border { Height = 72, CornerRadius = new CornerRadius(6) };
        private int frame;
        private int clicks;

        internal FixtureWindow(string readyPath, int screenIndex)
        {
            this.readyPath = Path.GetFullPath(readyPath);
            Title = "Hook Live Screenshot Phase 0 WPF Fixture";
            Width = 686;
            Height = 470;
            ResizeMode = ResizeMode.NoResize;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Topmost = true;

            Forms.Screen[] screens = Forms.Screen.AllScreens;
            if (screenIndex < 0 || screenIndex >= screens.Length)
            {
                throw new ArgumentOutOfRangeException("screenIndex");
            }
            Forms.Screen screen = screens[screenIndex];
            double scale = ScaleForScreen(screen);
            Left = (screen.WorkingArea.Left + Math.Max(0, (screen.WorkingArea.Width - Width * scale) / 2)) / scale;
            Top = (screen.WorkingArea.Top + Math.Max(0, (screen.WorkingArea.Height - Height * scale) / 2)) / scale;

            AutomationProperties.SetAutomationId(this, "liveScreenshotFixture");
            AutomationProperties.SetName(this, "Live screenshot WPF fixture");
            ConfigureAutomation(progress, "buildProgress", "Build progress");
            ConfigureAutomation(frameLabel, "animationLabel", "Animation frame");
            ConfigureAutomation(statusLabel, "statusLabel", statusLabel.Text);
            ConfigureAutomation(animatedSurface, "animatedSurface", "Animated surface");

            var actionButton = new Button { Content = "Apply action", Width = 130, Height = 30 };
            ConfigureAutomation(actionButton, "actionButton", "Phase zero action");
            actionButton.Click += delegate
            {
                clicks++;
                statusLabel.Text = "Clicks: " + clicks;
                AutomationProperties.SetName(statusLabel, statusLabel.Text);
            };

            var textValue = new TextBox { Text = "editable text", Width = 360, Height = 26 };
            ConfigureAutomation(textValue, "textValue", "Editable text");
            var toggleValue = new CheckBox { Content = "Enabled", IsChecked = true };
            ConfigureAutomation(toggleValue, "toggleValue", "Enabled");
            var rangeValue = new Slider { Minimum = 0, Maximum = 100, Value = 40, Width = 560 };
            ConfigureAutomation(rangeValue, "rangeValue", "Range value");

            var content = new StackPanel { Margin = new Thickness(32) };
            content.Children.Add(new TextBlock { Text = "Animated WPF/UIA fixture", FontSize = 18 });
            content.Children.Add(animatedSurface);
            content.Children.Add(progress);
            content.Children.Add(frameLabel);
            content.Children.Add(actionButton);
            content.Children.Add(statusLabel);
            content.Children.Add(textValue);
            content.Children.Add(toggleValue);
            content.Children.Add(rangeValue);
            Content = content;

            timer.Tick += delegate
            {
                frame++;
                progress.Value = frame % 101;
                frameLabel.Text = "Frame: " + frame;
                animatedSurface.Background = new SolidColorBrush(
                    frame % 2 == 0 ? Color.FromRgb(36, 47, 68) : Color.FromRgb(79, 58, 35));
            };
            Loaded += delegate
            {
                timer.Start();
                WriteReadyFile();
            };
            Closed += delegate { timer.Stop(); };
        }

        private static void ConfigureAutomation(DependencyObject control, string id, string name)
        {
            AutomationProperties.SetAutomationId(control, id);
            AutomationProperties.SetName(control, name);
        }

        private static double ScaleForScreen(Forms.Screen screen)
        {
            var point = new NativePoint { X = screen.Bounds.Left + 1, Y = screen.Bounds.Top + 1 };
            uint dpiX;
            uint dpiY;
            try
            {
                IntPtr monitor = MonitorFromPoint(point, 2);
                if (monitor != IntPtr.Zero && GetDpiForMonitor(monitor, 0, out dpiX, out dpiY) == 0 && dpiX > 0)
                {
                    return dpiX / 96.0;
                }
            }
            catch (DllNotFoundException)
            {
                // Windows versions without shcore use the 100 percent fallback.
            }
            return 1.0;
        }

        private void WriteReadyFile()
        {
            var helper = new System.Windows.Interop.WindowInteropHelper(this);
            NativeRect rect;
            if (!GetWindowRect(helper.Handle, out rect))
            {
                throw new InvalidOperationException("GetWindowRect failed");
            }
            Directory.CreateDirectory(Path.GetDirectoryName(readyPath));
            string json = string.Format(
                System.Globalization.CultureInfo.InvariantCulture,
                "{{\"schemaVersion\":1,\"hwnd\":\"0x{0:x}\",\"bounds\":[{1},{2},{3},{4}]}}",
                helper.Handle.ToInt64(), rect.Left, rect.Top, rect.Right, rect.Bottom);
            File.WriteAllText(readyPath, json);
        }
    }
}
