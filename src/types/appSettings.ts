import {
    DEFAULT_FILE_NAMING_SETTINGS,
    type FileNamingSettings,
} from "./fileNaming";

export interface AppSettings {
    schemaVersion: number;
    fileNaming: FileNamingSettings;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
    schemaVersion: 1,
    fileNaming: { ...DEFAULT_FILE_NAMING_SETTINGS },
};
