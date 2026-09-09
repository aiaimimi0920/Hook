using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Hook.LiveScreenshot.PhaseZero
{
    internal static class Program
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
                // Windows versions without per-monitor-v2 support remain valid baseline targets.
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            int parsed;
            int screenIndex = args.Length > 1 && int.TryParse(args[1], out parsed) ? parsed : 0;
            Application.Run(new FixtureForm(args[0], screenIndex, args.Length > 2 ? args[2] : null));
        }
    }

    internal sealed class FixtureForm : Form
    {
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
        [DllImport("user32.dll", EntryPoint = "SendMessageW")]
        private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wparam, ref NativeRect rect);

        private readonly string readyPath;
        private readonly string statePath;
        private readonly Timer animationTimer = new Timer { Interval = 80 };
        private readonly ProgressBar progress = new ProgressBar
        {
            Name = "buildProgress",
            AccessibleName = "Build progress",
            Minimum = 0,
            Maximum = 100,
            Width = 560,
            Height = 28,
        };
        private readonly Label animationLabel = new Label
        {
            Name = "animationLabel",
            AutoSize = true,
            Text = "Frame: 0",
        };
        private readonly Label statusLabel = new Label
        {
            Name = "statusLabel",
            AutoSize = true,
            Text = "Clicks: 0",
        };
        private readonly Label keyStatusLabel = new Label
        {
            Name = "keyStatusLabel",
            AutoSize = true,
            Text = "Keys: 0",
        };
        private readonly Label dragStatusLabel = new Label
        {
            Name = "dragStatusLabel",
            AutoSize = true,
            Text = "Drag edges: 0",
        };
        private readonly Button actionButton = new Button
        {
            Name = "actionButton",
            AccessibleName = "Phase zero action",
            Text = "Apply action",
            AutoSize = true,
        };
        private readonly TrackBar rangeValue = new TrackBar
        {
            Name = "rangeValue",
            Minimum = 0,
            Maximum = 100,
            Value = 40,
            Width = 560,
        };
        private int frame;
        private int clicks;
        private int keyEdges;
        private int dragEdges;
        private int trackDowns;
        private int trackMoves;
        private int trackUps;
        private bool dragActive;

        internal FixtureForm(string readyPath, int screenIndex, string statePath)
        {
            this.readyPath = Path.GetFullPath(readyPath);
            this.statePath = string.IsNullOrWhiteSpace(statePath) ? null : Path.GetFullPath(statePath);
            Text = "Hook Live Screenshot Phase 0 Fixture";
            Name = "liveScreenshotFixture";
            ClientSize = new Size(680, 430);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = true;
            StartPosition = FormStartPosition.Manual;
            TopMost = Environment.GetEnvironmentVariable("HOOK_LIVE_FIXTURE_BACKGROUND") != "1";
            if (Environment.GetEnvironmentVariable("HOOK_LIVE_FIXTURE_VIDEO") == "1") animationTimer.Interval = 16;

            Screen[] screens = Screen.AllScreens;
            if (screenIndex < 0 || screenIndex >= screens.Length)
            {
                throw new ArgumentOutOfRangeException("screenIndex");
            }
            Screen screen = screens[screenIndex];
            Location = new Point(
                screen.WorkingArea.Left + Math.Max(0, (screen.WorkingArea.Width - Width) / 2),
                screen.WorkingArea.Top + Math.Max(0, (screen.WorkingArea.Height - Height) / 2));

            actionButton.Click += (_, __) =>
            {
                clicks++;
                statusLabel.Text = "Clicks: " + clicks;
                WriteStateFile();
            };
            actionButton.KeyDown += (_, __) => UpdateKeyEdges();
            actionButton.KeyUp += (_, __) => UpdateKeyEdges();
            actionButton.MouseDown += (_, eventArgs) =>
            {
                if (eventArgs.Button != MouseButtons.Left) return;
                dragActive = true;
                UpdateDragEdges();
            };
            actionButton.MouseMove += (_, __) =>
            {
                if (dragActive) UpdateDragEdges();
            };
            actionButton.MouseUp += (_, eventArgs) =>
            {
                if (eventArgs.Button != MouseButtons.Left) return;
                UpdateDragEdges();
                dragActive = false;
            };
            rangeValue.ValueChanged += (_, __) => WriteStateFile();
            rangeValue.MouseDown += (_, __) => { trackDowns++; WriteStateFile(); };
            rangeValue.MouseMove += (_, e) => { if (e.Button == MouseButtons.Left) { trackMoves++; WriteStateFile(); } };
            rangeValue.MouseUp += (_, __) => { trackUps++; WriteStateFile(); };

            var controls = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                Padding = new Padding(32),
            };
            controls.Controls.Add(new Label { AutoSize = true, Text = "Animated WinForms/UIA fixture" });
            controls.Controls.Add(progress);
            controls.Controls.Add(animationLabel);
            controls.Controls.Add(actionButton);
            controls.Controls.Add(statusLabel);
            controls.Controls.Add(keyStatusLabel);
            controls.Controls.Add(dragStatusLabel);
            controls.Controls.Add(new TextBox { Name = "textValue", Text = "editable text", Width = 360 });
            controls.Controls.Add(new CheckBox { Name = "toggleValue", Text = "Enabled", Checked = true });
            controls.Controls.Add(rangeValue);
            Controls.Add(controls);

            animationTimer.Tick += (_, __) =>
            {
                frame++;
                progress.Value = frame % 101;
                animationLabel.Text = "Frame: " + frame;
                BackColor = frame % 2 == 0 ? Color.FromArgb(238, 244, 252) : Color.FromArgb(252, 244, 238);
            };
            Shown += (_, __) =>
            {
                animationTimer.Start();
                WriteReadyFile();
                WriteStateFile();
            };
            FormClosed += (_, __) => animationTimer.Stop();
        }

        protected override bool ShowWithoutActivation
        {
            get { return Environment.GetEnvironmentVariable("HOOK_LIVE_FIXTURE_BACKGROUND") == "1"; }
        }

        private void UpdateKeyEdges()
        {
            keyEdges++;
            keyStatusLabel.Text = "Keys: " + keyEdges;
            WriteStateFile();
        }

        private void UpdateDragEdges()
        {
            dragEdges++;
            dragStatusLabel.Text = "Drag edges: " + dragEdges;
            WriteStateFile();
        }

        private void WriteReadyFile()
        {
            NativeRect rect;
            if (!GetWindowRect(Handle, out rect))
            {
                throw new InvalidOperationException("GetWindowRect failed");
            }
            Directory.CreateDirectory(Path.GetDirectoryName(readyPath));
            Point action = PointToClient(actionButton.PointToScreen(new Point(
                actionButton.ClientSize.Width / 2, actionButton.ClientSize.Height / 2)));
            Point dragEnd = PointToClient(actionButton.PointToScreen(new Point(
                Math.Max(1, actionButton.ClientSize.Width - 4), actionButton.ClientSize.Height / 2)));
            Point track = PointToClient(rangeValue.PointToScreen(new Point(
                rangeValue.ClientSize.Width / 2, rangeValue.ClientSize.Height / 2)));
            NativeRect thumbRect = new NativeRect();
            SendMessage(rangeValue.Handle, 0x0419, IntPtr.Zero, ref thumbRect);
            Point thumb = PointToClient(rangeValue.PointToScreen(new Point(
                (thumbRect.Left + thumbRect.Right) / 2, (thumbRect.Top + thumbRect.Bottom) / 2)));
            string json = string.Format(
                System.Globalization.CultureInfo.InvariantCulture,
                "{{\"schemaVersion\":1,\"hwnd\":\"0x{0:x}\",\"bounds\":[{1},{2},{3},{4}]," +
                "\"targets\":{{\"action\":[{5:R},{6:R}],\"dragEnd\":[{7:R},{8:R}],\"track\":[{9:R},{10:R}],\"trackThumb\":[{11:R},{12:R}]}}}}",
                Handle.ToInt64(), rect.Left, rect.Top, rect.Right, rect.Bottom,
                (double)action.X / ClientSize.Width, (double)action.Y / ClientSize.Height,
                (double)dragEnd.X / ClientSize.Width, (double)dragEnd.Y / ClientSize.Height,
                (double)track.X / ClientSize.Width, (double)track.Y / ClientSize.Height,
                (double)thumb.X / ClientSize.Width, (double)thumb.Y / ClientSize.Height);
            File.WriteAllText(readyPath, json);
        }

        private void WriteStateFile()
        {
            if (statePath == null) return;
            Directory.CreateDirectory(Path.GetDirectoryName(statePath));
            string json = string.Format(
                System.Globalization.CultureInfo.InvariantCulture,
                "{{\"schemaVersion\":1,\"clicks\":{0},\"keyEdges\":{1},\"dragEdges\":{2},\"trackValue\":{3},\"trackDowns\":{4},\"trackMoves\":{5},\"trackUps\":{6}}}",
                clicks, keyEdges, dragEdges, rangeValue.Value, trackDowns, trackMoves, trackUps);
            File.WriteAllText(statePath, json);
        }
    }
}
