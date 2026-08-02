import type { Unit } from "../types/unit";
import {
    DEFAULT_FILE_NAMING_SETTINGS,
    FILE_NAMING_PLACEHOLDERS,
    type FileNamingContext,
    type FileNamingSettings,
} from "../types/fileNaming";

const MAX_FILENAME_STEM_CHARS = 120;
const RESERVED_DEVICE_NAMES = new Set(["CON", "PRN", "AUX", "NUL"]);

const pad2 = (value: number) => String(value).padStart(2, "0");

const lastUnicodeScalars = (value: string, count: number) =>
    Array.from(value).slice(-count).join("");

export const normalizeFileNamingSettings = (
    value: Partial<FileNamingSettings> | null | undefined,
): FileNamingSettings => {
    const candidate = value ?? {};
    const normalized: FileNamingSettings = {
        stickerSavePattern:
            typeof candidate.stickerSavePattern === "string"
                ? candidate.stickerSavePattern
                : DEFAULT_FILE_NAMING_SETTINGS.stickerSavePattern,
        dragExportPattern:
            typeof candidate.dragExportPattern === "string"
                ? candidate.dragExportPattern
                : DEFAULT_FILE_NAMING_SETTINGS.dragExportPattern,
        clipboardFilePattern:
            typeof candidate.clipboardFilePattern === "string"
                ? candidate.clipboardFilePattern
                : DEFAULT_FILE_NAMING_SETTINGS.clipboardFilePattern,
        titleMaxLength:
            typeof candidate.titleMaxLength === "number" && Number.isFinite(candidate.titleMaxLength)
                ? Math.min(240, Math.max(1, Math.round(candidate.titleMaxLength)))
                : DEFAULT_FILE_NAMING_SETTINGS.titleMaxLength,
        collisionPolicy: "increment",
    };

    if (validateFileNamingPattern(normalized.stickerSavePattern)) {
        normalized.stickerSavePattern = DEFAULT_FILE_NAMING_SETTINGS.stickerSavePattern;
    }
    if (validateFileNamingPattern(normalized.dragExportPattern)) {
        normalized.dragExportPattern = DEFAULT_FILE_NAMING_SETTINGS.dragExportPattern;
    }
    if (validateFileNamingPattern(normalized.clipboardFilePattern)) {
        normalized.clipboardFilePattern = DEFAULT_FILE_NAMING_SETTINGS.clipboardFilePattern;
    }
    return normalized;
};

export const validateFileNamingPattern = (pattern: string): string | null => {
    if (!pattern.trim()) return "模板不能为空";
    const supported = new Set<string>(FILE_NAMING_PLACEHOLDERS);
    for (let index = 0; index < pattern.length; index += 1) {
        const current = pattern[index];
        if (current === "}") return "存在未配对的右花括号";
        if (current !== "{") continue;
        const end = pattern.indexOf("}", index + 1);
        if (end < 0) return "存在未闭合的占位符";
        const name = pattern.slice(index + 1, end);
        if (!name) return "占位符不能为空";
        if (!supported.has(name)) return `不支持占位符 {${name}}`;
        index = end;
    }
    return null;
};

export const sanitizeWindowsFilenameStem = (value: string): string => {
    let output = "";
    let previousReplacement = false;
    for (const char of value) {
        const invalid =
            /\p{Cc}/u.test(char) ||
            "/\\:*?\"<>|".includes(char);
        if (invalid) {
            if (!previousReplacement) output += "_";
            previousReplacement = true;
        } else {
            output += char;
            previousReplacement = false;
        }
    }

    output = Array.from(output).slice(0, MAX_FILENAME_STEM_CHARS).join("");
    output = output.replace(/[. ]+$/u, "");
    if (!output || output === "." || output === "..") output = "Hook";

    const base = output.replace(/[. ]+$/u, "").split(".", 1)[0].toUpperCase();
    const numberedDevice = /^(COM|LPT)([1-9])$/u.test(base);
    if (RESERVED_DEVICE_NAMES.has(base) || numberedDevice) {
        output = `_${output}`;
        output = Array.from(output).slice(0, MAX_FILENAME_STEM_CHARS).join("");
    }
    return output;
};

export const renderFileNamingStem = (
    pattern: string,
    context: FileNamingContext,
    settings: FileNamingSettings,
    now = new Date(),
): string => {
    const title = Array.from(context.title ?? "")
        .slice(0, settings.titleMaxLength)
        .join("");
    const unitId = context.unitId ?? "";
    const values: Record<string, string> = {
        app: context.app?.trim() || "Hook",
        kind: context.kind?.trim() || "image",
        label: context.label?.trim() || context.kind?.trim() || "image",
        title,
        process: context.process ?? "",
        unitId,
        shortId: context.shortId?.trim() || lastUnicodeScalars(unitId, 4),
        width: typeof context.width === "number" ? String(Math.round(context.width)) : "",
        height: typeof context.height === "number" ? String(Math.round(context.height)) : "",
        date: `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`,
        time: `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}${pad2(Math.floor(now.getMilliseconds() / 10))}`,
        timestamp: String(now.getTime()),
    };
    const rendered = pattern.replace(/\{([^{}]+)\}/gu, (_match, name: string) => values[name] ?? "");
    return sanitizeWindowsFilenameStem(rendered);
};

export const buildUnitFileNamingContext = (
    unit: Unit,
    capabilityLabel?: string,
): FileNamingContext => ({
    app: "Hook",
    kind: unit.type,
    label: capabilityLabel?.trim() || (unit.type === "art" ? "art" : "image"),
    title: capabilityLabel?.trim() || "",
    process: unit.artId || "",
    unitId: unit.id,
    shortId: lastUnicodeScalars(unit.id, 4),
    width: Math.max(1, Math.round(unit.w)),
    height: Math.max(1, Math.round(unit.h)),
});
