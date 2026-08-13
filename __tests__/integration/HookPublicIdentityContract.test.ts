import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tauriConfig = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
);
const rustSource = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
const readmeSource = readFileSync(resolve(process.cwd(), "README.md"), "utf8");
const architectureSource = readFileSync(
    resolve(process.cwd(), "TECHNICAL_ARCHITECTURE.md"),
    "utf8",
);

describe("Hook public identity contract", () => {
    it("uses the yamiyu company Tauri identifier without changing the visible product name", () => {
        expect(tauriConfig.identifier).toBe("com.yamiyu.hook");
        expect(tauriConfig.productName).toBe("hook");
    });

    it("uses only the current app-data identity unless an explicit override is configured", () => {
        expect(rustSource).not.toContain("LEGACY_TAURI_IDENTIFIERS");
        expect(rustSource).not.toContain("legacy_app_data_dirs_from_current");
        expect(rustSource).toContain("fn resolve_effective_app_data_dir");
        expect(rustSource).toContain("fn effective_app_data_dir");
        expect(rustSource).toContain('const APP_DATA_OVERRIDE_ENV: &str = "HOOK_APPDATA_DIR";');
    });

    it("documents the current public bundle identity without obsolete app-data paths", () => {
        expect(readmeSource).toContain("com.yamiyu.hook");
        expect(architectureSource).toContain("com.yamiyu.hook");
        expect(readmeSource).toContain("yamiyu");
    });
});
