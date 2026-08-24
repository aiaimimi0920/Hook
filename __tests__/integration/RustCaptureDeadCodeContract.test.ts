import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const captureSource = readFileSync(resolve(process.cwd(), "src-tauri/src/capture.rs"), "utf8");
const screenshotSources = [
    "src-tauri/src/screenshot.rs",
    "src-tauri/src/screenshot/display_selection.rs",
    "src-tauri/src/screenshot/dispatch.rs",
    "src-tauri/src/screenshot/gdi_fallback.rs",
].map((path) => readFileSync(resolve(process.cwd(), path), "utf8")).join("\n");

describe("Hook Rust capture dead-code contract", () => {
    it("keeps the backend capture API focused on region capture without unused primary-monitor helpers", () => {
        expect(captureSource).not.toContain("capture_primary_monitor");
        expect(screenshotSources).not.toContain("capture_primary_display");
        expect(screenshotSources).not.toContain("capture_display_bounds_gdi");
    });
});
