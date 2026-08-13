import type {
    StickerCreateTool,
    StickerCreateToolProfiles,
    StickerToolProfileSettingKey,
    StickerToolProfileSettings,
    StickerToolSettings,
} from "../types/stickerEditing";
import { createDefaultStickerToolSettings } from "./stickerEditing";

const normalizeFontFamily = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

const STICKER_EDITING_DOMAINS = ["existing", "create", "sticker"] as const;
const STICKER_TRANSFORM_MODES = ["select", "move", "rotate", "scale"] as const;
const STICKER_CANVAS_TOOLS = ["idle", "crop", "content-eraser"] as const;
const STICKER_CREATE_TOOLS = [
    "crop",
    "shape-rect",
    "shape-round-rect",
    "shape-ellipse",
    "shape-triangle",
    "shape-polygon",
    "line",
    "polyline",
    "arrow",
    "text",
    "brush",
    "highlighter",
    "serial",
    "mosaic",
    "blur",
    "content-eraser",
    "color-picker",
] as const;

const TOOL_PROFILE_SETTING_KEYS = [
    "strokeWidth",
    "textSize",
    "shapeCornerRadius",
    "shapeConstrainSquare",
    "shapeSnapStep",
    "shapeStrokeDashPattern",
    "polygonSides",
    "lineArrowEnabled",
    "lineAngleSnap",
    "brushHighlighterEnabled",
    "effectBrushSize",
    "blurStrength",
    "mosaicSize",
    "textFontFamily",
    "serialRadius",
    "serialFontFamily",
] as const satisfies readonly StickerToolProfileSettingKey[];

const TOOL_PROFILE_KEYS_BY_TOOL: Record<StickerCreateTool, readonly StickerToolProfileSettingKey[]> = {
    crop: [],
    "shape-rect": ["strokeWidth", "shapeCornerRadius", "shapeConstrainSquare", "shapeSnapStep", "shapeStrokeDashPattern"],
    "shape-round-rect": ["strokeWidth", "shapeCornerRadius", "shapeConstrainSquare", "shapeSnapStep", "shapeStrokeDashPattern"],
    "shape-ellipse": ["strokeWidth", "shapeConstrainSquare", "shapeSnapStep", "shapeStrokeDashPattern"],
    "shape-triangle": ["strokeWidth", "shapeCornerRadius", "shapeConstrainSquare", "shapeSnapStep", "shapeStrokeDashPattern"],
    "shape-polygon": [
        "strokeWidth",
        "shapeCornerRadius",
        "shapeConstrainSquare",
        "shapeSnapStep",
        "shapeStrokeDashPattern",
        "polygonSides",
    ],
    line: ["strokeWidth", "shapeStrokeDashPattern", "lineArrowEnabled", "lineAngleSnap"],
    polyline: ["strokeWidth", "shapeStrokeDashPattern"],
    arrow: ["strokeWidth", "shapeStrokeDashPattern", "lineAngleSnap"],
    text: ["textSize", "textFontFamily"],
    brush: ["strokeWidth", "shapeStrokeDashPattern", "brushHighlighterEnabled"],
    highlighter: ["strokeWidth", "shapeStrokeDashPattern", "brushHighlighterEnabled"],
    serial: ["serialRadius", "serialFontFamily"],
    mosaic: ["effectBrushSize", "mosaicSize"],
    blur: ["effectBrushSize", "blurStrength"],
    "content-eraser": [],
    "color-picker": [],
};

const isEditingDomain = (value: unknown): value is StickerToolSettings["domain"] =>
    typeof value === "string" && STICKER_EDITING_DOMAINS.includes(value as StickerToolSettings["domain"]);

const isTransformMode = (value: unknown): value is StickerToolSettings["transformMode"] =>
    typeof value === "string" && STICKER_TRANSFORM_MODES.includes(value as StickerToolSettings["transformMode"]);

const isCanvasTool = (value: unknown): value is StickerToolSettings["activeCanvasTool"] =>
    typeof value === "string" && STICKER_CANVAS_TOOLS.includes(value as StickerToolSettings["activeCanvasTool"]);

const isCreateTool = (value: unknown): value is StickerToolSettings["activeTool"] =>
    typeof value === "string" && STICKER_CREATE_TOOLS.includes(value as StickerToolSettings["activeTool"]);

const isToolProfileSettingKey = (value: string): value is StickerToolProfileSettingKey =>
    (TOOL_PROFILE_SETTING_KEYS as readonly string[]).includes(value);

const cloneDefaultToolProfiles = () => {
    const { toolProfiles } = createDefaultStickerToolSettings();
    return structuredClone(toolProfiles);
};

const resolveActiveProfileTool = (activeTool: StickerCreateTool): StickerCreateTool | null =>
    activeTool === "crop" || activeTool === "content-eraser" || activeTool === "color-picker"
        ? null
        : activeTool;

const setProfileSetting = (
    profile: Partial<StickerToolProfileSettings>,
    key: StickerToolProfileSettingKey,
    value: StickerToolProfileSettings[StickerToolProfileSettingKey],
) => {
    (
        profile as Record<
            StickerToolProfileSettingKey,
            StickerToolProfileSettings[StickerToolProfileSettingKey] | undefined
        >
    )[key] = value;
};

const setFlattenedToolSetting = (
    settings: StickerToolSettings,
    key: StickerToolProfileSettingKey,
    value: StickerToolProfileSettings[StickerToolProfileSettingKey],
) => {
    (
        settings as unknown as Record<
            StickerToolProfileSettingKey,
            StickerToolProfileSettings[StickerToolProfileSettingKey]
        >
    )[key] = value;
};

const normalizeToolProfiles = (
    value: unknown,
    defaults: StickerCreateToolProfiles,
): StickerCreateToolProfiles => {
    const next = structuredClone(defaults);
    if (!value || typeof value !== "object") {
        return next;
    }

    for (const [tool, profile] of Object.entries(value)) {
        if (!isCreateTool(tool) || !profile || typeof profile !== "object") continue;
        const target = { ...(next[tool] ?? {}) } as Partial<StickerToolProfileSettings>;
        for (const [key, raw] of Object.entries(profile)) {
            if (!isToolProfileSettingKey(key) || raw === undefined) continue;
            if (key === "textFontFamily") {
                target.textFontFamily = normalizeFontFamily(raw, createDefaultStickerToolSettings().textFontFamily);
                continue;
            }
            if (key === "serialFontFamily") {
                target.serialFontFamily = normalizeFontFamily(raw, createDefaultStickerToolSettings().serialFontFamily);
                continue;
            }
            setProfileSetting(target, key, raw as StickerToolProfileSettings[typeof key]);
        }
        next[tool] = target;
    }

    return next;
};

const applyActiveToolProfile = (settings: StickerToolSettings): StickerToolSettings => {
    const targetTool = resolveActiveProfileTool(settings.activeTool);
    if (!targetTool) return settings;

    const profile = settings.toolProfiles[targetTool];
    if (!profile) return settings;

    const next: StickerToolSettings = { ...settings };
    for (const key of TOOL_PROFILE_KEYS_BY_TOOL[targetTool]) {
        const value = profile[key];
        if (value === undefined) continue;
        setFlattenedToolSetting(next, key, value);
    }
    return next;
};

const normalizeModeFields = (
    value: Partial<StickerToolSettings> | null | undefined,
    defaults: StickerToolSettings,
) => {
    const transformMode = isTransformMode(value?.transformMode)
        ? value.transformMode
        : defaults.transformMode;

    const activeCanvasTool = isCanvasTool(value?.activeCanvasTool)
        ? value.activeCanvasTool
        : defaults.activeCanvasTool;

    const activeToolCandidate = isCreateTool(value?.activeTool)
        && value.activeTool !== "crop"
        && value.activeTool !== "content-eraser"
            ? value.activeTool
            : defaults.activeTool;

    const activeTool = activeToolCandidate;

    const domain = isEditingDomain(value?.domain)
        ? value.domain
        : defaults.domain;

    const resolvedMode =
        domain === "existing"
            ? transformMode
            : domain === "sticker"
              ? activeCanvasTool
              : activeTool;

    return {
        domain,
        mode: resolvedMode,
        transformMode,
        activeCanvasTool,
        activeTool,
    };
};

export const normalizeStickerToolSettings = (
    value: Partial<StickerToolSettings> | null | undefined,
): StickerToolSettings => {
    const defaults = createDefaultStickerToolSettings();
    const normalizedModeFields = normalizeModeFields(value, defaults);
    const next: StickerToolSettings = {
        ...defaults,
        ...value,
        ...normalizedModeFields,
        toolProfiles: normalizeToolProfiles(value?.toolProfiles, cloneDefaultToolProfiles()),
        brushHighlighterEnabled: value?.brushHighlighterEnabled ?? defaults.brushHighlighterEnabled,
        textFontFamily: normalizeFontFamily(value?.textFontFamily, defaults.textFontFamily),
        serialFontFamily: normalizeFontFamily(value?.serialFontFamily, defaults.serialFontFamily),
    };

    return applyActiveToolProfile(next);
};

export const applyStickerToolSettingsPatch = (
    prev: StickerToolSettings,
    updates: Partial<StickerToolSettings>,
): StickerToolSettings => {
    const targetTool = resolveActiveProfileTool(
        isCreateTool(updates.activeTool) ? updates.activeTool : prev.activeTool,
    );

    const mergedProfiles = normalizeToolProfiles(
        updates.toolProfiles
            ? { ...prev.toolProfiles, ...updates.toolProfiles }
            : prev.toolProfiles,
        cloneDefaultToolProfiles(),
    );

    if (targetTool) {
        const relevantKeys = TOOL_PROFILE_KEYS_BY_TOOL[targetTool].filter((key) => updates[key] !== undefined);
        if (relevantKeys.length > 0) {
            const currentProfile = { ...(mergedProfiles[targetTool] ?? {}) } as Partial<StickerToolProfileSettings>;
            for (const key of relevantKeys) {
                setProfileSetting(
                    currentProfile,
                    key,
                    updates[key] as StickerToolProfileSettings[typeof key],
                );
            }
            mergedProfiles[targetTool] = currentProfile;
        }
    }

    return normalizeStickerToolSettings({
        ...prev,
        ...updates,
        toolProfiles: mergedProfiles,
    });
};
