import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
    readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("cache, settings, and internal file lifetime contract", () => {
    it("clears unit-scoped caches on deletion and workspace replacement", () => {
        const graphStore = readSource("src/store/graphStore.ts");
        const syncService = readSource("src/services/syncService.ts");
        const stickerGroupBar = readSource("src/components/StickerGroupBar.tsx");

        expect(graphStore).toContain("clearImageSearchPrefetchGenerationForUnit(id)");
        expect(graphStore).toContain("clearSyncImageCachesForUnit(id)");
        expect(graphStore).toContain("clearAllImageSearchPrefetchGenerations()");
        expect(graphStore).toContain("clearAllSyncImageCaches()");
        expect(syncService).toContain("graphStore.actions.replaceUnits(loadedUnits)");
        expect(syncService).toContain("isSyncImageCacheTokenCurrent(unit.id, cacheToken)");
        expect(syncService).toContain("isSyncImageCacheEpochCurrent(syncEpoch)");
        expect(syncService).toContain("syncRequests.push({ workflowId: dominantWfId, snapshot })");
        expect(stickerGroupBar).toContain("uiActions.clearUnitUiState(id)");
        expect(stickerGroupBar).toContain("uiActions.dismissEnhancementNotice(id)");
    });

    it("serves file naming settings from managed state instead of loading them per export", () => {
        const rust = readSource("src-tauri/src/lib.rs");
        const start = rust.indexOf("fn current_file_naming_settings");
        const end = rust.indexOf("fn image_dimensions_from_bytes", start);
        const block = rust.slice(start, end);

        expect(rust).toContain("struct AppSettingsState");
        expect(rust).toContain("app.manage(AppSettingsState::new(initial_app_settings))");
        expect(block).toContain("app.try_state::<AppSettingsState>()");
        expect(block).not.toContain("app_settings::load_app_settings");
    });

    it("uses create-new allocation for corrupt backups and internal capture files", () => {
        const settings = readSource("src-tauri/src/app_settings.rs");
        const rust = readSource("src-tauri/src/lib.rs");

        expect(settings).toContain("create_new(true)");
        expect(settings).not.toContain("if !candidate.exists()");
        expect(settings).toContain("static APP_SETTINGS_IO_LOCK: Mutex<()>");
        expect(settings).toContain("current_bytes != corrupted_bytes");
        expect(rust).toContain("fn create_internal_capture_file(");
        expect(rust).toContain("create_unique_file(cache_dir");
        expect(rust).toContain("let _ = fs::remove_file(&file_path);");
        expect(rust).not.toContain('cache_dir.join(format!(\n        "Hook_long_capture_{}.png"');
        expect(rust).not.toContain('cache_dir.join(format!(\n        "Hook_hdr_capture_{}.png"');
    });
});
