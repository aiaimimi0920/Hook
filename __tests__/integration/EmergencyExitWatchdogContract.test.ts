import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const watchdog = readFileSync(
    resolve(root, "src-tauri/src/emergency_watchdog.rs"),
    "utf8",
);
const main = readFileSync(resolve(root, "src-tauri/src/main.rs"), "utf8");
const lib = readFileSync(resolve(root, "src-tauri/src/lib.rs"), "utf8");

describe("Hook emergency exit watchdog contract", () => {
    it("runs outside the Tauri event loop and terminates the parent on physical double Escape", () => {
        expect(main).toContain("emergency_watchdog::parse_parent_pid");
        expect(main.indexOf("emergency_watchdog::parse_parent_pid")).toBeLessThan(
            main.indexOf("hook_lib::run()"),
        );
        expect(lib).toContain("emergency_watchdog::spawn_for_current_process()");
        expect(watchdog).toContain("GetAsyncKeyState");
        expect(watchdog).toContain("TerminateProcess");
        expect(watchdog).toContain("EMERGENCY_ESCAPE_WINDOW");
        expect(watchdog).toContain("Duration::from_millis(8)");
        expect(watchdog).toContain("validate_direct_parent(parent_pid, actual_parent_pid)");
        expect(watchdog).toContain("creation_flags(CREATE_NO_WINDOW.0)");
    });

    it("keeps a modifier backup chord and restores OS input state before termination", () => {
        expect(watchdog).toContain("VK_CONTROL");
        expect(watchdog).toContain("VK_MENU");
        expect(watchdog).toContain("VK_SHIFT");
        expect(watchdog).toContain("VK_F12");
        expect(watchdog).toContain("ClipCursor(None)");
        expect(watchdog).toContain("SPI_SETCURSORS");
        expect(lib).toContain("Ctrl+Alt+Shift+F12");
    });
});
