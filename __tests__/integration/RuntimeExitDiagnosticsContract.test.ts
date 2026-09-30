import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
    readFileSync(resolve(process.cwd(), "src-tauri/src", path), "utf8");

describe("exit diagnostics survive teardown", () => {
    it("persists the original panic before cleanup can re-enter native window code", () => {
        const source = read("native/runtime_logging.rs");
        const panic = source.slice(source.indexOf("fn install_panic_logger"));
        expect(panic.indexOf("append_runtime_log_line_sync(&line)")).toBeGreaterThan(-1);
        expect(panic.indexOf("append_runtime_log_line_sync(&line)")).toBeLessThan(
            panic.indexOf('prepare_for_hook_process_exit("panic")'),
        );
    });

    it("records explicit tray exit separately from the event-loop exit request", () => {
        const setup = read("native/app_setup.rs");
        const tray = setup.slice(setup.indexOf('"quit" => {'));
        expect(tray.indexOf('record_process_exit_event("tray_quit", Some(0))')).toBeLessThan(
            tray.indexOf("app.exit(0)"),
        );
        const runtime = read("native/app_runtime.rs");
        expect(runtime).toContain('record_process_exit_event("tauri_exit_requested", code)');
        expect(runtime).toContain('record_process_exit_event("tauri_run_returned", Some(exit_code))');
        const logging = read("native/runtime_logging.rs");
        const start = logging.indexOf("fn record_process_exit_event");
        const record = logging.slice(start, logging.indexOf("fn install_panic_logger", start));
        expect(record).toContain("append_runtime_log_line_sync");
        expect(record).toContain("std::process::id()");
        expect(record).not.toContain("try_send");
        expect(record).not.toContain("RUNTIME_LOG_LEVEL.load");
    });
});
