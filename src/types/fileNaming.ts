export type CollisionPolicy = "increment";

export interface FileNamingSettings {
    stickerSavePattern: string;
    dragExportPattern: string;
    clipboardFilePattern: string;
    titleMaxLength: number;
    collisionPolicy: CollisionPolicy;
}

export interface FileNamingContext {
    app?: string;
    kind?: string;
    label?: string;
    title?: string;
    process?: string;
    unitId?: string;
    shortId?: string;
    width?: number;
    height?: number;
}

export const DEFAULT_FILE_NAMING_SETTINGS: FileNamingSettings = {
    stickerSavePattern: "Hook_{date}_{time}_{width}x{height}",
    dragExportPattern: "{label}_{shortId}_{date}_{time}",
    clipboardFilePattern: "Hook_{kind}_{date}_{time}",
    titleMaxLength: 80,
    collisionPolicy: "increment",
};

export const FILE_NAMING_PLACEHOLDERS = [
    "app",
    "kind",
    "label",
    "title",
    "process",
    "unitId",
    "shortId",
    "width",
    "height",
    "date",
    "time",
    "timestamp",
] as const;

export type FileNamingPlaceholder = (typeof FILE_NAMING_PLACEHOLDERS)[number];
