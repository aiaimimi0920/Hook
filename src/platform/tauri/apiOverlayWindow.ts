// Owns overlay, window, and native input-mode command names and argument casing.
import { safeInvoke } from "./apiTransport";
import type { PinRect } from "./apiTypes";

export const overlayWindowApi = {
    hasForegroundWindow: (): Promise<boolean> =>
        safeInvoke("otter_has_foreground_window", undefined, () => true),

    updatePinRects: (rects: PinRect[]): Promise<void> =>
        safeInvoke("update_pin_rects", { rects }, () => undefined),

    initializeOverlay: (): Promise<void> =>
        safeInvoke("initialize_overlay", undefined, () => undefined),

    showOverlayHost: (clickThrough = true): Promise<void> =>
        safeInvoke("show_overlay_host", { clickThrough }, () => undefined),

    setOverlayClickThrough: (clickThrough: boolean): Promise<void> =>
        safeInvoke("set_overlay_click_through", { clickThrough }, () => undefined),

    setNativeStickerDragPreflight: (active: boolean): Promise<void> =>
        safeInvoke("set_native_drag_preflight_active", { active }, () => undefined),

    setOverlayKeyboardCaptureActive: (active: boolean): Promise<void> =>
        safeInvoke("set_overlay_keyboard_capture_active", { active }, () => undefined),

    focusOverlayWindow: (): Promise<void> =>
        safeInvoke("focus_overlay_window", undefined, () => undefined),

    setOverlayCaptureExclusion: (enabled: boolean): Promise<void> =>
        safeInvoke("set_overlay_capture_exclusion", { enabled }, () => undefined),

    showCanvasWindow: (): Promise<void> =>
        safeInvoke("show_canvas_window", undefined, () => undefined),

    hideToTray: (): Promise<void> =>
        safeInvoke("hide_to_tray", undefined, () => undefined),

    triggerCaptureMode: (): Promise<void> =>
        safeInvoke("trigger_capture_mode", undefined, () => undefined),

    setCaptureInputActive: (active: boolean, longCapture = false): Promise<void> =>
        safeInvoke("set_capture_input_active", { active, longCapture }, () => undefined),

    setDesktopColorPickerActive: (active: boolean): Promise<void> =>
        safeInvoke("set_desktop_color_picker_active", { active }, () => undefined),

    debugLogEvent: (event: string, detail?: string): Promise<void> =>
        safeInvoke("append_runtime_log", { event, detail }, () => undefined),

    setMouseMonitorActive: (active: boolean): Promise<void> =>
        safeInvoke("set_mouse_monitor_active", { active }, () => undefined),

    restoreOverlayTextCursor: (): Promise<void> =>
        safeInvoke("restore_overlay_text_cursor", undefined, () => undefined),
};
