// Owns boot, tool, application, shortcut, and font settings commands.
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../types/appSettings";
import { defaultBootProfile, normalizeBootProfile, type BootProfile } from "./bootProfile";
import { safeInvoke } from "./apiTransport";
import type { ToolSettingsData } from "./apiTypes";

export const bootSettingsApi = {
    getBootProfile: (): Promise<BootProfile> =>
        safeInvoke("get_boot_profile", undefined, () => defaultBootProfile, false).then(normalizeBootProfile),

    loadToolSettings: (): Promise<ToolSettingsData> =>
        safeInvoke("load_tool_settings", undefined, () => ({ stickerToolSettings: null }), false),

    saveToolSettings: (stickerToolSettings: Record<string, unknown>): Promise<void> =>
        safeInvoke("save_tool_settings", { stickerToolSettings }, () => undefined, false),

    loadAppSettings: (): Promise<AppSettings> =>
        safeInvoke(
            "load_app_settings",
            undefined,
            () => ({
                ...DEFAULT_APP_SETTINGS,
                fileNaming: { ...DEFAULT_APP_SETTINGS.fileNaming },
                cache: { ...DEFAULT_APP_SETTINGS.cache },
            }),
            false,
        ),

    saveAppSettings: (settings: AppSettings): Promise<AppSettings> =>
        safeInvoke("save_app_settings", { settings }, () => settings, false),

    getLoomShortcutSettings: (): Promise<unknown | null> =>
        safeInvoke("get_loom_shortcut_settings", undefined, () => null, false),

    getInstalledFonts: (): Promise<string[]> =>
        safeInvoke("get_installed_fonts", undefined, () => [], false),
};
