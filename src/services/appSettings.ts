import { api } from "./api";
import {
    DEFAULT_APP_SETTINGS,
    DEFAULT_HOOK_CACHE_SETTINGS,
    type AppSettings,
    type HookCacheSettings,
} from "../types/appSettings";
import { normalizeFileNamingSettings } from "./fileNaming";

let currentSettings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    fileNaming: { ...DEFAULT_APP_SETTINGS.fileNaming },
    cache: { ...DEFAULT_APP_SETTINGS.cache },
};

export const normalizeHookCacheSettings = (
    value: Partial<HookCacheSettings> | null | undefined,
): HookCacheSettings => {
    const recycleBinMaxEntries = Math.round(value?.recycleBinMaxEntries ?? DEFAULT_HOOK_CACHE_SETTINGS.recycleBinMaxEntries);
    const tempCacheMaxBytes = Math.round(value?.tempCacheMaxBytes ?? DEFAULT_HOOK_CACHE_SETTINGS.tempCacheMaxBytes);
    return {
    recycleBinMaxEntries: recycleBinMaxEntries === 0 ? 0 : Math.min(500, Math.max(1, recycleBinMaxEntries)),
    recycleBinRetentionDays: Math.min(3650, Math.max(0, Math.round(value?.recycleBinRetentionDays ?? DEFAULT_HOOK_CACHE_SETTINGS.recycleBinRetentionDays))),
    tempCacheMaxBytes: tempCacheMaxBytes === 0 ? 0 : Math.min(16 * 1024 * 1024 * 1024, Math.max(32 * 1024 * 1024, tempCacheMaxBytes)),
    tempCacheRetentionDays: Math.min(3650, Math.max(0, Math.round(value?.tempCacheRetentionDays ?? DEFAULT_HOOK_CACHE_SETTINGS.tempCacheRetentionDays))),
    };
};

export const normalizeAppSettings = (
    value: Partial<AppSettings> | null | undefined,
): AppSettings => ({
    schemaVersion: 2,
    fileNaming: normalizeFileNamingSettings(value?.fileNaming),
    cache: normalizeHookCacheSettings(value?.cache),
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
