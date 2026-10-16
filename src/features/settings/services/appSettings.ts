import { api } from "../../../platform/tauri/api";
import {
    DEFAULT_APP_SETTINGS,
    DEFAULT_OTTER_CACHE_SETTINGS,
    type AppSettings,
    type OtterCacheSettings,
} from "../types/appSettings";
import { normalizeFileNamingSettings } from "./fileNaming";

let currentSettings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    fileNaming: { ...DEFAULT_APP_SETTINGS.fileNaming },
    cache: { ...DEFAULT_APP_SETTINGS.cache },
    translationTargetLanguage: DEFAULT_APP_SETTINGS.translationTargetLanguage,
    translationProviderMode: DEFAULT_APP_SETTINGS.translationProviderMode,
};

const normalizeTranslationTargetLanguage = (
    value: unknown,
): AppSettings["translationTargetLanguage"] =>
    value === "zh-CN" || value === "en" ? value : "";

const normalizeTranslationProviderMode = (
    value: unknown,
): AppSettings["translationProviderMode"] =>
    value === "local" || value === "gateway" ? value : "auto";

export const normalizeOtterCacheSettings = (
    value: Partial<OtterCacheSettings> | null | undefined,
): OtterCacheSettings => {
    const recycleBinMaxEntries = Math.round(value?.recycleBinMaxEntries ?? DEFAULT_OTTER_CACHE_SETTINGS.recycleBinMaxEntries);
    const tempCacheMaxBytes = Math.round(value?.tempCacheMaxBytes ?? DEFAULT_OTTER_CACHE_SETTINGS.tempCacheMaxBytes);
    return {
    recycleBinMaxEntries: recycleBinMaxEntries === 0 ? 0 : Math.min(500, Math.max(1, recycleBinMaxEntries)),
    recycleBinRetentionDays: Math.min(3650, Math.max(0, Math.round(value?.recycleBinRetentionDays ?? DEFAULT_OTTER_CACHE_SETTINGS.recycleBinRetentionDays))),
    tempCacheMaxBytes: tempCacheMaxBytes === 0 ? 0 : Math.min(16 * 1024 * 1024 * 1024, Math.max(32 * 1024 * 1024, tempCacheMaxBytes)),
    tempCacheRetentionDays: Math.min(3650, Math.max(0, Math.round(value?.tempCacheRetentionDays ?? DEFAULT_OTTER_CACHE_SETTINGS.tempCacheRetentionDays))),
    };
};

export const normalizeAppSettings = (
    value: Partial<AppSettings> | null | undefined,
): AppSettings => ({
    schemaVersion: 2,
    fileNaming: normalizeFileNamingSettings(value?.fileNaming),
    cache: normalizeOtterCacheSettings(value?.cache),
    translationTargetLanguage: normalizeTranslationTargetLanguage(value?.translationTargetLanguage),
    translationProviderMode: normalizeTranslationProviderMode(value?.translationProviderMode),
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
