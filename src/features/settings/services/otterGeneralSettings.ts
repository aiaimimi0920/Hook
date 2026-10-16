export type OtterTheme = "system" | "dark" | "light";
export type OtterLanguage = "zh-Hans" | "en";

export interface OtterGeneralSettings {
    theme: OtterTheme;
    language: OtterLanguage;
    closeToTray: boolean;
}

export const DEFAULT_OTTER_GENERAL_SETTINGS: OtterGeneralSettings = {
    theme: "system",
    language: "zh-Hans",
    closeToTray: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === "object" && value !== null && !Array.isArray(value)
);

export const normalizeOtterGeneralSettings = (value: unknown): OtterGeneralSettings => {
    if (!isRecord(value)) return { ...DEFAULT_OTTER_GENERAL_SETTINGS };
    const theme = value.theme === "dark" || value.theme === "light" || value.theme === "system"
        ? value.theme
        : DEFAULT_OTTER_GENERAL_SETTINGS.theme;
    const language = value.language === "en" || value.language === "zh-Hans"
        ? value.language
        : DEFAULT_OTTER_GENERAL_SETTINGS.language;
    const closeToTray = typeof value.close_to_tray === "boolean"
        ? value.close_to_tray
        : typeof value.closeToTray === "boolean"
            ? value.closeToTray
            : DEFAULT_OTTER_GENERAL_SETTINGS.closeToTray;
    return { theme, language, closeToTray };
};

export const applyOtterGeneralSettings = (
    settings: OtterGeneralSettings,
    documentRef: Document = document,
): void => {
    const root = documentRef.documentElement;
    root.lang = settings.language;
    root.dataset.otterTheme = settings.theme;
    root.style.colorScheme = settings.theme === "system" ? "light dark" : settings.theme;
};
