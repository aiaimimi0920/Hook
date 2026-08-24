// Owns overlay, window, and native input-mode command names and argument casing.
import { safeInvoke } from "./apiTransport";
import type { PinRect } from "./apiTypes";

export const overlayWindowApi = {
    hasForegroundWindow: (): Promise<boolean> =>
        safeInvoke("hook_has_foreground_window", undefined, () => true, false),

    updatePinRects: (rects: PinRect[]): Promise<void> =>
        safeInvoke("update_pin_rects", { rects }, () => undefined, false),

    initializeOverlay: (): Promise<void> =>
        safeInvoke("initialize_overlay", undefined, () => undefined, false),

    showOverlayHost: (clickThrough = true): Promise<void> =>
        safeInvoke("show_overlay_host", { clickThrough }, () => undefined, false),

    setOverlayClickThrough: (clickThrough: boolean): Promise<void> =>
        safeInvoke("set_overlay_click_through", { clickThrough }, () => undefined, false),

    setNativeStickerDragPreflight: (active: boolean): Promise<void> =>
        safeInvoke("set_native_drag_preflight_active", { active }, () => undefined, false),

    setOverlayKeyboardCaptureActive: (active: boolean): Promise<void> =>
        safeInvoke("set_overlay_keyboard_capture_active", { active }, () => undefined, false),

    focusOverlayWindow: (): Promise<void> =>
        safeInvoke("focus_overlay_window", undefined, () => undefined, false),

    setOverlayCaptureExclusion: (enabled: boolean): Promise<void> =>
        safeInvoke("set_overlay_capture_exclusion", { enabled }, () => undefined, false),

    showCanvasWindow: (): Promise<void> =>
        safeInvoke("show_canvas_window", undefined, () => undefined, false),

    hideToTray: (): Promise<void> =>
        safeInvoke("hide_to_tray", undefined, () => undefined, false),

    triggerCaptureMode: (): Promise<void> =>
        safeInvoke("trigger_capture_mode", undefined, () => undefined, false),

    setCaptureInputActive: (active: boolean): Promise<void> =>
        safeInvoke("set_capture_input_active", { active }, () => undefined, false),

    setDesktopColorPickerActive: (active: boolean): Promise<void> =>
        safeInvoke("set_desktop_color_picker_active", { active }, () => undefined, false),

    debugLogEvent: (event: string, detail?: string): Promise<void> =>
        safeInvoke("append_runtime_log", { event, detail }, () => undefined, false),

    setMouseMonitorActive: (active: boolean): Promise<void> =>
        safeInvoke("set_mouse_monitor_active", { active }, () => undefined, false),
};
