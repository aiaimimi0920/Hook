import {
    DEFAULT_FILE_NAMING_SETTINGS,
    type FileNamingSettings,
} from "./fileNaming";

export interface AppSettings {
    schemaVersion: number;
    fileNaming: FileNamingSettings;
    cache: HookCacheSettings;
}

export interface HookCacheSettings {
    recycleBinMaxEntries: number;
    recycleBinRetentionDays: number;
    tempCacheMaxBytes: number;
    tempCacheRetentionDays: number;
}

export const DEFAULT_HOOK_CACHE_SETTINGS: HookCacheSettings = {
    recycleBinMaxEntries: 15,
    recycleBinRetentionDays: 0,
    tempCacheMaxBytes: 256 * 1024 * 1024,
    tempCacheRetentionDays: 7,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
    schemaVersion: 2,
    fileNaming: { ...DEFAULT_FILE_NAMING_SETTINGS },
    cache: { ...DEFAULT_HOOK_CACHE_SETTINGS },
};
