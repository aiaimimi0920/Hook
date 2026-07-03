import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const captureSource = readFileSync(resolve(process.cwd(), "src-tauri/src/capture.rs"), "utf8");
const screenshotSource = readFileSync(resolve(process.cwd(), "src-tauri/src/screenshot.rs"), "utf8");

describe("Hook Rust capture dead-code contract", () => {
    it("keeps the backend capture API focused on region capture without unused primary-monitor helpers", () => {
        expect(captureSource).not.toContain("capture_primary_monitor");
        expect(screenshotSource).not.toContain("capture_primary_display");
        expect(screenshotSource).not.toContain("capture_display_bounds_gdi");
    });
});
