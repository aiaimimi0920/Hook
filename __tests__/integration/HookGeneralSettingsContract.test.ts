import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readHookLibRustSources } from "../helpers/hookLibRustSources";
import { readLoomHookRustSources } from "../helpers/loomHookRustSources";

describe("Loom-managed Hook general settings contract", () => {
    it("applies live general settings beside shortcuts and cache settings", () => {
        const appSource = readFileSync(resolve(process.cwd(), "src", "app.tsx"), "utf8");
        const artWorkflowSource = readFileSync(
            resolve(process.cwd(), "src", "services", "appArtWorkflowController.ts"),
            "utf8",
        );
        const artControlSource = readFileSync(
            resolve(process.cwd(), "src", "services", "appArtControlListeners.ts"),
            "utf8",
        );

        expect(appSource).toContain("applyLoomManagedSettings");
        expect(artWorkflowSource).toContain("normalizeHookGeneralSettings");
        expect(artWorkflowSource).toContain("record.hook_general");
        expect(artWorkflowSource).not.toContain("record.hook_general || record.hookGeneral");
        expect(appSource).toContain("registerAppArtControlListeners");
        expect(artControlSource).toContain("hook/settings_updated");
    });

    it("lets the native close handler choose tray or exit from the current setting", () => {
        const rustSource = readHookLibRustSources();

        expect(rustSource).toContain("shortcut_config::close_to_tray_enabled()");
        expect(rustSource).toContain("window_close_requested :: action=tray");
        expect(rustSource).toContain("window_close_requested :: action=exit");
        expect(rustSource).toMatch(/api\.prevent_close\(\);[\s\S]*?window\.hide\(\)/);
        expect(rustSource).toContain("window.app_handle().exit(0)");
    });

    it("defines light and system theme token overrides", () => {
        const cssSource = readFileSync(
            resolve(process.cwd(), "src", "styles", "theme-foundation.css"),
            "utf8",
        );

        expect(cssSource).toContain(':root[data-hook-theme="light"]');
        expect(cssSource).toContain(':root[data-hook-theme="system"]');
        expect(cssSource).toContain("@media (prefers-color-scheme: light)");
    });

    it("applies Loom-managed proxy and log settings to native Hook clients", () => {
        const bridgeSource = readLoomHookRustSources();
        const nativeSource = readHookLibRustSources();
        const proxySource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "network_proxy.rs"), "utf8");
        const teaSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "tea_client.rs"), "utf8");
        const loomConfigSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "loom_config.rs"), "utf8");
        const voiceSource = readFileSync(resolve(process.cwd(), "src-tauri", "src", "voice", "client.rs"), "utf8");

        expect(bridgeSource).toContain("network_proxy::apply_loom_settings(settings)");
        expect(bridgeSource).toContain("configure_runtime_log_level_from_loom(settings)");
        expect(nativeSource).toContain("RUNTIME_LOG_LEVEL");
        expect(proxySource).toContain("pub fn shared_client_with(");
        expect(proxySource).toContain("settings.network.hook.mode");
        expect(proxySource).toContain("endpoint_is_loopback");
        expect(proxySource).toContain("apply_to_url(Client::builder(), endpoint)");
        expect(teaSource).toContain("network_proxy::apply_to_url");
        expect(loomConfigSource).toContain("network_proxy::shared_client");
        expect(voiceSource.match(/network_proxy::apply_to_url/g)).toHaveLength(2);
    });
});
