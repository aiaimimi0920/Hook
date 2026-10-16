import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { readOtterLibRustSources } from "../helpers/otterLibRustSources";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const rustSettings = readSource("src-tauri/src/app_settings.rs");
const rustEntry = readOtterLibRustSources();
const bootSettingsApiSource = readSource("src/platform/tauri/apiBootSettings.ts");
const appSource = readSource("src/app/app.tsx");
const commandSource = readSource("src/app/appCommandListeners.ts");
const dialogSource = readSource("src/features/settings/components/AppSettingsDialog.tsx");

describe("Otter app settings contract", () => {
    it("persists an independent schema-versioned app-settings.json atomically", () => {
        expect(rustSettings).toContain('const APP_SETTINGS_FILE_NAME: &str = "app-settings.json"');
        expect(rustSettings).toContain("pub schema_version: u32");
        expect(rustSettings).toContain("create_new(true)");
        expect(rustSettings).toContain("file.flush()");
        expect(rustSettings).toContain("file.sync_all()");
        expect(rustSettings).toContain("MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH");
        expect(rustSettings).toContain("app-settings.corrupt-");
        expect(rustSettings).not.toContain("tool-settings.json");
    });

    it("registers typed load/save commands while keeping the settings tray entry hidden", () => {
        expect(rustEntry).toContain("save_app_settings,");
        expect(rustEntry).toContain("load_app_settings,");
        expect(rustEntry).not.toContain('MenuItem::with_id(app, "settings"');
        expect(rustEntry).toContain('"settings" => {');
        expect(rustEntry).toContain('window.emit("trigger-open-app-settings", ())');
        expect(bootSettingsApiSource).toContain("loadAppSettings");
        expect(bootSettingsApiSource).toContain("saveAppSettings");
        expect(appSource).toContain("registerAppCommandListeners");
        expect(commandSource).toContain('listen("trigger-open-app-settings"');
        expect(appSource).toContain("<AppSettingsDialog");
    });

    it("provides three patterns, live previews, validation and restore-default controls", () => {
        expect(dialogSource).toContain('key: "stickerSavePattern"');
        expect(dialogSource).toContain('key: "dragExportPattern"');
        expect(dialogSource).toContain('key: "clipboardFilePattern"');
        expect(dialogSource).toContain("renderFileNamingStem(");
        expect(dialogSource).toContain("validateFileNamingPattern(");
        expect(dialogSource).toContain("恢复默认");
        expect(dialogSource).toContain("FILE_NAMING_PLACEHOLDERS");
    });
});
