import { api } from "./api";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../types/appSettings";
import { normalizeFileNamingSettings } from "./fileNaming";

let currentSettings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    fileNaming: { ...DEFAULT_APP_SETTINGS.fileNaming },
};

export const normalizeAppSettings = (
    value: Partial<AppSettings> | null | undefined,
): AppSettings => ({
    schemaVersion: 1,
    fileNaming: normalizeFileNamingSettings(value?.fileNaming),
});

export const getCurrentAppSettings = (): AppSettings => currentSettings;

export const setCurrentAppSettings = (settings: AppSettings): AppSettings => {
    currentSettings = normalizeAppSettings(settings);
    return currentSettings;
};

export const loadCurrentAppSettings = async (): Promise<AppSettings> =>
    setCurrentAppSettings(await api.loadAppSettings());

export const saveCurrentAppSettings = async (settings: AppSettings): Promise<AppSettings> =>
    setCurrentAppSettings(await api.saveAppSettings(normalizeAppSettings(settings)));
