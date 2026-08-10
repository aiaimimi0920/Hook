export type HookTheme = "system" | "dark" | "light";
export type HookLanguage = "zh-Hans" | "en";

export interface HookGeneralSettings {
    theme: HookTheme;
    language: HookLanguage;
    closeToTray: boolean;
}

export const DEFAULT_HOOK_GENERAL_SETTINGS: HookGeneralSettings = {
    theme: "system",
    language: "zh-Hans",
    closeToTray: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === "object" && value !== null && !Array.isArray(value)
);

export const normalizeHookGeneralSettings = (value: unknown): HookGeneralSettings => {
    if (!isRecord(value)) return { ...DEFAULT_HOOK_GENERAL_SETTINGS };
    const theme = value.theme === "dark" || value.theme === "light" || value.theme === "system"
        ? value.theme
        : DEFAULT_HOOK_GENERAL_SETTINGS.theme;
    const language = value.language === "en" || value.language === "zh-Hans"
        ? value.language
        : DEFAULT_HOOK_GENERAL_SETTINGS.language;
    const closeToTray = typeof value.close_to_tray === "boolean"
        ? value.close_to_tray
        : typeof value.closeToTray === "boolean"
            ? value.closeToTray
            : DEFAULT_HOOK_GENERAL_SETTINGS.closeToTray;
    return { theme, language, closeToTray };
};

export const applyHookGeneralSettings = (
    settings: HookGeneralSettings,
    documentRef: Document = document,
): void => {
    const root = documentRef.documentElement;
    root.lang = settings.language;
    root.dataset.hookTheme = settings.theme;
    root.style.colorScheme = settings.theme === "system" ? "light dark" : settings.theme;
};
