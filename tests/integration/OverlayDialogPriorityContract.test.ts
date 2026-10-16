import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (name: string) => {
    const owner = name.startsWith("capture_") ? "input" : "overlay";
    return readFileSync(`src-tauri/src/native/${owner}/${name}.rs`, "utf8");
};

describe("dialog and secure desktop input priority wiring", () => {
    it("checks real visible-window ownership on input edges without expanding the capture or move hot path", () => {
        for (const file of ["capture_mouse_hook_proc", "overlay_input_shield_router"]) {
            expect(source(file)).toContain("overlay_visible_hit::needs_visible_hit_check(message)");
            expect(source(file)).toContain("overlay_visible_hit::blocks_edge(x, y)");
        }
        const hit = source("overlay_visible_hit");
        expect(hit).toContain("WindowFromPoint(point)");
        expect(hit).toContain("GetAncestor(hwnd, GA_ROOT)");
        expect(hit).toContain("window_is_above_overlay_in_z_order(candidate, main)");
        expect(hit).not.toContain("GetWindowText");
        expect(hit).not.toContain('"#32770"');
        expect(source("overlay_dialog_priority")).toContain("overlay_visible_hit::foreground_above");
    });
    it("uses the same priority anchor for the visual overlay and both shield placement paths", () => {
        for (const file of ["overlay_occlusion", "overlay_input_shield_window", "overlay_input_shield_region"]) {
            expect(source(file)).toContain("Some(overlay_dialog_priority::insert_after())");
        }
    });
    it("excludes dialog pixels from native and synthetic input rather than only lowering visual content", () => {
        expect(source("overlay_input_routing")).toContain("overlay_dialog_priority::blocks_point(x, y)");
        expect(source("overlay_keyboard_routing")).toContain("overlay_dialog_priority::blocks_keyboard()");
        for (const file of ["capture_mouse_hook_proc", "overlay_input_shield_router"]) {
            expect(source(file)).toContain("should_route_overlay_mouse_events(x, y)");
            expect(source(file)).toContain("overlay_dialog_priority::request_claim()");
        }
    });
    it("claims priority on deliberate capture/focus, not on background hit-map updates", () => {
        expect(source("capture_input_state")).toContain("overlay_dialog_priority::claim()");
        expect(source("overlay_commands")).toContain("overlay_dialog_priority::claim()");
        expect(source("overlay_input_shield_region")).not.toContain("overlay_dialog_priority::claim()");
    });
    it("fails closed on secure desktops and clears stale input intentions", () => {
        const priority = source("overlay_dialog_priority");
        expect(priority).toContain("ensure_live_input_desktop().is_err()");
        expect(priority).toContain("POINTER_INTENT.store(0, Ordering::SeqCst)");
        expect(priority).not.toContain("SwitchDesktop(");
        expect(priority).not.toContain("SetThreadDesktop(");
        expect(source("overlay_topmost_maintenance")).toContain('emit("trigger-escape", ())');
        for (const file of ["capture_mouse_hook_proc", "overlay_keyboard_hook"]) {
            expect(source(file)).toContain("overlay_dialog_priority::DESKTOP_UNAVAILABLE.load");
        }
    });
});
