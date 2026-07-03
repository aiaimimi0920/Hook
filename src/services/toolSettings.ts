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
    brush: ["strokeWidth", "shapeSnapStep", "shapeStrokeDashPattern", "brushHighlighterEnabled"],
    highlighter: ["strokeWidth", "shapeSnapStep", "shapeStrokeDashPattern", "brushHighlighterEnabled"],
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

const migrateLegacySharedValuesIntoProfiles = (
    settings: StickerToolSettings,
    incoming: Partial<StickerToolSettings> | null | undefined,
): StickerCreateToolProfiles => {
    const next = structuredClone(settings.toolProfiles);

    for (const [tool, keys] of Object.entries(TOOL_PROFILE_KEYS_BY_TOOL) as Array<
        [StickerCreateTool, readonly StickerToolProfileSettingKey[]]
    >) {
        if (keys.length < 1) continue;
        const current = { ...(next[tool] ?? {}) } as Partial<StickerToolProfileSettings>;
        for (const key of keys) {
            if (incoming?.[key] === undefined) continue;
            const value = incoming[key];
            if (value === undefined) continue;
            setProfileSetting(current, key, value as StickerToolProfileSettings[typeof key]);
        }
        next[tool] = current;
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
    const legacyMode = value?.mode;
    const legacyTool = value?.activeTool;
    const legacyHighlighterRequested = legacyMode === "highlighter" || legacyTool === "highlighter";

    const transformMode = isTransformMode(value?.transformMode)
        ? value.transformMode
        : isTransformMode(legacyMode)
          ? legacyMode
          : defaults.transformMode;

    const legacyCanvasTool =
        legacyMode === "crop" || legacyTool === "crop"
            ? "crop"
            : legacyMode === "content-eraser" || legacyTool === "content-eraser"
              ? "content-eraser"
              : null;

    const activeCanvasTool = isCanvasTool(value?.activeCanvasTool)
        ? value.activeCanvasTool
        : legacyCanvasTool ?? defaults.activeCanvasTool;

    const activeToolCandidate = isCreateTool(value?.activeTool)
        && value.activeTool !== "crop"
        && value.activeTool !== "content-eraser"
            ? value.activeTool
            : isCreateTool(legacyMode)
              && legacyMode !== "crop"
              && legacyMode !== "content-eraser"
                ? legacyMode
                : defaults.activeTool;

    const activeTool = activeToolCandidate === "highlighter"
        ? "brush"
        : activeToolCandidate;

    const domain = isEditingDomain(value?.domain)
        ? value.domain
        : isTransformMode(legacyMode) || isTransformMode(value?.transformMode)
          ? "existing"
          : legacyCanvasTool || isCanvasTool(value?.activeCanvasTool)
            ? "sticker"
            : "create";

    const resolvedMode =
        domain === "existing"
            ? transformMode
            : domain === "sticker"
              ? activeCanvasTool
              : activeTool;

    const mode =
        legacyHighlighterRequested
            ? resolvedMode
            : typeof legacyMode === "string"
              ? legacyMode
              : resolvedMode;

    return {
        domain,
        mode,
        transformMode,
        activeCanvasTool,
        activeTool,
        legacyHighlighterRequested,
    };
};

export const normalizeStickerToolSettings = (
    value: Partial<StickerToolSettings> | null | undefined,
): StickerToolSettings => {
    const defaults = createDefaultStickerToolSettings();
    const normalizedModeFields = normalizeModeFields(value, defaults);
    const { legacyHighlighterRequested, ...normalizedSettings } = normalizedModeFields;
    const hasIncomingProfiles = !!value?.toolProfiles;
    let next: StickerToolSettings = {
        ...defaults,
        ...value,
        ...normalizedSettings,
        toolProfiles: normalizeToolProfiles(value?.toolProfiles, cloneDefaultToolProfiles()),
        brushHighlighterEnabled:
            legacyHighlighterRequested
                ? true
                : value?.brushHighlighterEnabled ?? defaults.brushHighlighterEnabled,
        textFontFamily: normalizeFontFamily(value?.textFontFamily, defaults.textFontFamily),
        serialFontFamily: normalizeFontFamily(value?.serialFontFamily, defaults.serialFontFamily),
    };

    if (!hasIncomingProfiles) {
        next = {
            ...next,
            toolProfiles: migrateLegacySharedValuesIntoProfiles(next, value),
        };
    }

    if (legacyHighlighterRequested) {
        next = {
            ...next,
            brushHighlighterEnabled: true,
            toolProfiles: {
                ...next.toolProfiles,
                brush: {
                    ...(next.toolProfiles.brush ?? {}),
                    brushHighlighterEnabled: true,
                },
            },
        };
    }

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
